"""Request-based Comp Off (leave/comp_off.py): an employee claims the off days
they worked, the request goes through the approvals engine, and an approval adds
one day per date to the leave balance the approver chooses at approval."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from approvals import service as approvals
from approvals.models import RequestStatus
from attendance.models import AttendanceRecord
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from leave.comp_off import LOOKBACK_DAYS
from leave.models import (
    CompOffRequest,
    LeaveBalance,
    LeaveRequest,
    LeaveRequestStatus,
    LeaveType,
)
from notifications.models import Notification
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/comp-off"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _setup():
    """An employee with a manager and Saturday + Sunday off. Returns a Comp Offs
    leave type too - the balance the tests have the approver choose."""
    manager_user = UserFactory(role=Role.objects.get(name="Manager"))
    manager = EmployeeFactory(user=manager_user)
    user = UserFactory(role=Role.objects.get(name="Employee"))
    employee = EmployeeFactory(user=user, manager=manager)
    make_calendar(employee)
    leave_type, _ = LeaveType.objects.get_or_create(
        name="Comp Offs", defaults={"annual_allocation": Decimal("0")}
    )
    return user, employee, manager_user, leave_type


def approve(row, approver, leave_type, note=""):
    """Approve through the engine the way the Approvals page does: with the
    leave balance the approver chose."""
    return approvals.decide(
        row.approval_request,
        approver,
        RequestStatus.APPROVED,
        note,
        {"leave_type_id": leave_type.pk},
    )


def off_days(count, *, skip=0):
    """The most recent Saturdays/Sundays before today, newest first."""
    today = timezone.localdate()
    found, day = [], today - timedelta(days=1)
    while len(found) < count + skip:
        if day.weekday() in (5, 6):
            found.append(day)
        day -= timedelta(days=1)
    return [d.isoformat() for d in found[skip:]]


def a_working_day():
    day = timezone.localdate() - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.isoformat()


def submit(client, dates, reason="Production support"):
    return client.post(URL, {"worked_dates": dates, "reason": reason}, format="json")


# ------------------------------ eligible days ------------------------------------------


def test_eligible_days_are_the_employees_off_days_within_the_window():
    user, employee, _, leave_type = _setup()
    client = _client(user)

    data = client.get(f"{URL}/eligible-days").json()["data"]

    assert "leave_type_id" not in data  # the approver chooses the balance later
    assert data["lookback_days"] == LOOKBACK_DAYS
    days = [d["date"] for d in data["days"]]
    assert days == sorted(days, reverse=True)
    assert days and all(timezone.localdate().isoformat() >= d for d in days)
    from datetime import date

    assert all(date.fromisoformat(d).weekday() in (5, 6) for d in days)
    assert all(d["reason"] == "Weekly off" for d in data["days"])
    assert all(d["clocked_in"] is False for d in data["days"])


def test_a_holiday_on_a_working_day_is_eligible_too():
    user, employee, _, _ = _setup()
    working = a_working_day()
    CalendarEntry.objects.create(
        calendar=employee.calendars.get(), type="holiday", date=working, name="Founders Day"
    )

    data = _client(user).get(f"{URL}/eligible-days").json()["data"]

    match = [d for d in data["days"] if d["date"] == working]
    assert match and match[0]["reason"] == "Holiday: Founders Day"


def test_an_optional_holiday_is_not_an_off_day():
    user, employee, _, _ = _setup()
    working = a_working_day()
    CalendarEntry.objects.create(
        calendar=employee.calendars.get(),
        type="holiday",
        date=working,
        name="Holi",
        optional=True,
    )

    days = [d["date"] for d in _client(user).get(f"{URL}/eligible-days").json()["data"]["days"]]

    assert working not in days


def test_an_employee_with_no_calendar_has_no_eligible_days():
    user, employee, _, _ = _setup()
    employee.calendars.clear()

    assert _client(user).get(f"{URL}/eligible-days").json()["data"]["days"] == []


def test_eligible_days_report_whether_the_employee_clocked_in():
    user, employee, _, _ = _setup()
    day = off_days(1)[0]
    AttendanceRecord.objects.create(
        employee=employee, attendance_date=day, clock_in_time=timezone.now()
    )

    data = _client(user).get(f"{URL}/eligible-days").json()["data"]

    assert {d["date"]: d["clocked_in"] for d in data["days"]}[day] is True


def test_eligible_days_exclude_days_already_claimed_or_on_leave():
    user, employee, _, leave_type = _setup()
    client = _client(user)
    claimed, on_leave = off_days(2)
    assert submit(client, [claimed]).status_code == 201
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=on_leave,
        end_date=on_leave,
        duration_days=Decimal("1"),
        financial_year=on_leave[:4],
        status=LeaveRequestStatus.APPROVED,
    )

    days = [d["date"] for d in client.get(f"{URL}/eligible-days").json()["data"]["days"]]

    assert claimed not in days and on_leave not in days


# ------------------------------ submitting ---------------------------------------------


def test_submitting_creates_a_pending_request_routed_to_the_manager():
    user, employee, manager_user, leave_type = _setup()
    dates = off_days(2)

    response = submit(_client(user), dates)

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "submitted"
    assert sorted(data["worked_dates"]) == sorted(dates)
    assert data["days"] == "2.0"
    assert data["leave_type_id"] is None and data["leave_type_name"] is None
    assert data["reason"] == "Production support"
    assert data["approver_id"] == str(manager_user.pk)
    assert data["approval_request_id"]
    row = CompOffRequest.objects.get()
    assert row.approval_request.request_type == "comp_off"
    assert row.approval_request.payload["comp_off_request_id"] == row.pk
    assert AuditLog.objects.filter(action="CompOffRequest.created").exists()
    # Nothing is credited, and no balance is even touched, until it is approved.
    assert not LeaveBalance.objects.filter(employee=employee, leave_type=leave_type).exists()


def test_the_dates_are_stored_in_order():
    user, _, _, _ = _setup()
    dates = off_days(3)

    data = submit(_client(user), list(reversed(dates))).json()["data"]

    assert data["worked_dates"] == sorted(dates)


@pytest.mark.parametrize("bad", [None, [], "2026-01-03", [""], ["not-a-date"], [123]])
def test_malformed_dates_are_rejected(bad):
    user, _, _, _ = _setup()

    assert submit(_client(user), bad).status_code == 400
    assert not CompOffRequest.objects.exists()


def test_a_working_day_cannot_be_claimed():
    user, _, _, _ = _setup()

    response = submit(_client(user), [a_working_day()])

    assert response.status_code == 400
    assert "can't be claimed" in str(response.json())


def test_one_bad_date_rejects_the_whole_request():
    user, _, _, _ = _setup()

    response = submit(_client(user), [*off_days(1), a_working_day()])

    assert response.status_code == 400
    assert not CompOffRequest.objects.exists()


def test_a_future_date_cannot_be_claimed():
    user, _, _, _ = _setup()
    today = timezone.localdate()
    future = today + timedelta(days=1)
    while future.weekday() not in (5, 6):
        future += timedelta(days=1)

    response = submit(_client(user), [future.isoformat()])

    assert response.status_code == 400


def test_a_date_older_than_the_window_cannot_be_claimed():
    user, _, _, _ = _setup()
    old = timezone.localdate() - timedelta(days=LOOKBACK_DAYS + 10)
    while old.weekday() not in (5, 6):
        old -= timedelta(days=1)

    assert submit(_client(user), [old.isoformat()]).status_code == 400


def test_the_same_date_twice_in_one_request_is_rejected():
    user, _, _, _ = _setup()
    day = off_days(1)[0]

    assert submit(_client(user), [day, day]).status_code == 400


def test_a_date_in_another_active_request_cannot_be_claimed_again():
    user, _, _, _ = _setup()
    client = _client(user)
    first, second = off_days(2)
    assert submit(client, [first]).status_code == 201

    assert submit(client, [first, second]).status_code == 400
    assert submit(client, [second]).status_code == 201


def test_a_date_from_an_approved_request_stays_claimed():
    user, employee, manager_user, _ = _setup()
    client = _client(user)
    day = off_days(1)[0]
    row = CompOffRequest.objects.get(pk=submit(client, [day]).json()["data"]["id"])
    approve(row, manager_user, _setup()[3])

    assert submit(client, [day]).status_code == 400


def test_a_rejected_or_cancelled_requests_dates_can_be_claimed_again():
    user, employee, manager_user, _ = _setup()
    client = _client(user)
    first, second = off_days(2)
    rejected = CompOffRequest.objects.get(pk=submit(client, [first]).json()["data"]["id"])
    approvals.decide(rejected.approval_request, manager_user, RequestStatus.REJECTED, "no")
    cancelled_id = submit(client, [second]).json()["data"]["id"]
    assert client.post(f"{URL}/{cancelled_id}/cancel").status_code == 200

    assert submit(client, [first, second]).status_code == 201


def test_a_day_on_approved_leave_cannot_be_claimed():
    user, employee, _, leave_type = _setup()
    day = off_days(1)[0]
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=day,
        end_date=day,
        duration_days=Decimal("1"),
        financial_year=day[:4],
        status=LeaveRequestStatus.APPROVED,
    )

    assert submit(_client(user), [day]).status_code == 400


def test_someone_with_no_employee_record_cannot_submit():
    user = UserFactory(role=Role.objects.get(name="Employee"))

    assert submit(_client(user), off_days(1)).status_code == 403


# ------------------------------ approving credits the balance ---------------------------


def test_approval_credits_one_day_per_date_to_the_balance_the_approver_chose():
    user, employee, manager_user, leave_type = _setup()
    dates = off_days(3)
    row = CompOffRequest.objects.get(pk=submit(_client(user), dates).json()["data"]["id"])

    approve(row, manager_user, leave_type, "thanks")

    row.refresh_from_db()
    assert row.status == LeaveRequestStatus.APPROVED and row.decided_at is not None
    assert row.leave_type == leave_type
    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("3")
    assert balance.available == Decimal("3")
    assert AuditLog.objects.filter(action="LeaveBalance.comp_off_credited").exists()
    assert Notification.objects.filter(user=user, type="comp_off.credited").exists()


def test_approval_adds_to_an_existing_balance_instead_of_replacing_it():
    user, employee, manager_user, leave_type = _setup()
    year = str(timezone.localdate().year)
    LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year=year,
        allocated=Decimal("2"),
        used=Decimal("1"),
    )
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(2)).json()["data"]["id"])

    approve(row, manager_user, leave_type)

    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("4") and balance.used == Decimal("1")
    assert balance.available == Decimal("3")


def test_the_credit_is_usable_for_leave_requests():
    user, employee, manager_user, leave_type = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(2)).json()["data"]["id"])
    approve(row, manager_user, leave_type)

    balances = _client(user).get("/api/v1/leave/balance").json()["data"]

    mine = [b for b in balances if b["leave_type_id"] == str(leave_type.pk)]
    assert mine and Decimal(mine[0]["available"]) == Decimal("2")


def test_rejection_credits_nothing():
    user, employee, manager_user, leave_type = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])

    approvals.decide(row.approval_request, manager_user, RequestStatus.REJECTED, "not needed")

    row.refresh_from_db()
    assert row.status == LeaveRequestStatus.REJECTED
    assert not LeaveBalance.objects.filter(employee=employee, leave_type=leave_type).exists()
    shown = _client(user).get(URL).json()["data"][0]
    assert shown["rejection_reason"] == "not needed"


def test_cancelling_a_pending_request_credits_nothing():
    user, employee, _, leave_type = _setup()
    client = _client(user)
    request_id = submit(client, off_days(1)).json()["data"]["id"]

    response = client.post(f"{URL}/{request_id}/cancel")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "cancelled"
    assert not LeaveBalance.objects.filter(employee=employee, leave_type=leave_type).exists()


def test_a_decided_request_cannot_be_cancelled_and_cannot_credit_twice():
    user, employee, manager_user, leave_type = _setup()
    client = _client(user)
    row = CompOffRequest.objects.get(pk=submit(client, off_days(1)).json()["data"]["id"])
    approve(row, manager_user, leave_type)

    assert client.post(f"{URL}/{row.pk}/cancel").status_code == 400
    with pytest.raises(Exception):
        approve(row, manager_user, leave_type)
    assert LeaveBalance.objects.get(employee=employee, leave_type=leave_type).allocated == 1


def test_each_approver_can_choose_a_different_balance():
    user, employee, manager_user, first = _setup()
    second = LeaveType.objects.create(name="Earned Leave", annual_allocation=Decimal("0"))
    client = _client(user)
    one, two = off_days(2)
    row_one = CompOffRequest.objects.get(pk=submit(client, [one]).json()["data"]["id"])
    row_two = CompOffRequest.objects.get(pk=submit(client, [two]).json()["data"]["id"])

    approve(row_one, manager_user, first)
    approve(row_two, manager_user, second)

    assert LeaveBalance.objects.get(employee=employee, leave_type=first).allocated == 1
    assert LeaveBalance.objects.get(employee=employee, leave_type=second).allocated == 1
    shown = {r["id"]: r["leave_type_name"] for r in client.get(URL).json()["data"]}
    assert shown == {str(row_one.pk): "Comp Offs", str(row_two.pk): "Earned Leave"}


def test_approving_without_choosing_a_balance_is_refused_and_leaves_it_pending():
    from rest_framework.exceptions import ValidationError

    user, employee, manager_user, leave_type = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])

    for data in (None, {}, {"leave_type_id": None}, {"leave_type_id": "abc"}):
        with pytest.raises(ValidationError):
            approvals.decide(row.approval_request, manager_user, RequestStatus.APPROVED, "", data)

    row.refresh_from_db()
    row.approval_request.refresh_from_db()
    assert row.status == LeaveRequestStatus.SUBMITTED
    assert row.approval_request.status == RequestStatus.PENDING
    assert row.leave_type is None
    assert not LeaveBalance.objects.filter(employee=employee).exists()


@pytest.mark.parametrize("which", ["unknown", "inactive"])
def test_the_chosen_balance_must_be_an_active_leave_type(which):
    from rest_framework.exceptions import ValidationError

    user, employee, manager_user, leave_type = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])
    if which == "inactive":
        leave_type.status = "inactive"
        leave_type.save()
    leave_type_id = 999999 if which == "unknown" else leave_type.pk

    with pytest.raises(ValidationError):
        approvals.decide(
            row.approval_request,
            manager_user,
            RequestStatus.APPROVED,
            "",
            {"leave_type_id": leave_type_id},
        )

    row.refresh_from_db()
    assert row.status == LeaveRequestStatus.SUBMITTED


def test_rejecting_needs_no_balance_choice():
    user, employee, manager_user, _ = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])

    approvals.decide(row.approval_request, manager_user, RequestStatus.REJECTED, "no")

    row.refresh_from_db()
    assert row.status == LeaveRequestStatus.REJECTED and row.leave_type is None


def test_other_request_types_are_unaffected_by_the_balance_hook():
    user, employee, manager_user, _ = _setup()
    other = approvals.create_request(user, "expense", {"amount": 5})

    approvals.decide(other, manager_user, RequestStatus.APPROVED)

    other.refresh_from_db()
    assert other.status == RequestStatus.APPROVED


def test_an_hr_override_resolution_credits_the_chosen_balance():
    user, employee, _, leave_type = _setup()
    hr = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr)
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])

    approvals.force_resolve(
        row.approval_request, hr, RequestStatus.APPROVED, "", {"leave_type_id": leave_type.pk}
    )

    assert LeaveBalance.objects.get(employee=employee, leave_type=leave_type).allocated == 1


# ------------------------------ listing, scope and approvals pages ----------------------


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401
    assert APIClient().post(URL, {}, format="json").status_code == 401
    assert APIClient().get(f"{URL}/eligible-days").status_code == 401


def test_employees_see_only_their_own_requests():
    user, _, _, _ = _setup()
    other_user, _, _, _ = _setup()
    submit(_client(user), off_days(1))
    submit(_client(other_user), off_days(1))

    mine = _client(user).get(URL).json()["data"]

    assert len(mine) == 1 and mine[0]["employee_name"] == (user.get_full_name() or user.username)


def test_an_employee_cannot_cancel_someone_elses_request():
    user, _, _, _ = _setup()
    intruder, _, _, _ = _setup()
    request_id = submit(_client(user), off_days(1)).json()["data"]["id"]

    assert _client(intruder).post(f"{URL}/{request_id}/cancel").status_code in (403, 404)
    assert CompOffRequest.objects.get(pk=request_id).status == LeaveRequestStatus.SUBMITTED


def test_the_manager_sees_pending_and_decided_requests_for_their_reports():
    user, employee, manager_user, leave_type = _setup()
    manager_client = _client(manager_user)
    first, second = off_days(2)
    pending_id = submit(_client(user), [first]).json()["data"]["id"]
    decided = CompOffRequest.objects.get(pk=submit(_client(user), [second]).json()["data"]["id"])
    approve(decided, manager_user, leave_type, "ok")

    pending = manager_client.get(f"{URL}/approvals/pending").json()["data"]
    history = manager_client.get(f"{URL}/approvals/history").json()["data"]

    assert [r["id"] for r in pending] == [pending_id]
    assert pending[0]["approval_request_id"] and pending[0]["approver_id"] == str(manager_user.pk)
    assert [r["id"] for r in history] == [str(decided.pk)]
    assert history[0]["status"] == "approved" and history[0]["approver_remarks"] == "ok"


def test_the_approvals_endpoints_are_closed_to_people_without_leave_approve():
    user, _, _, _ = _setup()
    client = _client(user)

    assert client.get(f"{URL}/approvals/pending").status_code == 403
    assert client.get(f"{URL}/approvals/history").status_code == 403


def test_a_manager_does_not_see_comp_off_requests_from_outside_their_team():
    user, _, _, _ = _setup()
    other_user, _, other_manager, _ = _setup()
    submit(_client(user), off_days(1))
    submit(_client(other_user), off_days(1))

    pending = _client(other_manager).get(f"{URL}/approvals/pending").json()["data"]

    assert len(pending) == 1


def test_the_generic_endpoints_refuse_a_comp_off_approval_without_a_balance():
    user, employee, manager_user, leave_type = _setup()
    hr = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr)
    data = submit(_client(user), off_days(1)).json()["data"]
    base = f"/api/v1/requests/{data['approval_request_id']}"

    assert (
        _client(manager_user).post(f"{base}/approve", {"note": "ok"}, format="json").status_code
        == 400
    )
    assert (
        _client(hr).post(f"{base}/resolve", {"status": "approved"}, format="json").status_code
        == 400
    )
    assert CompOffRequest.objects.get().status == LeaveRequestStatus.SUBMITTED
    # Rejecting needs no balance.
    assert (
        _client(manager_user).post(f"{base}/reject", {"note": "no"}, format="json").status_code
        == 200
    )


def test_the_approval_goes_through_the_generic_endpoint():
    user, employee, manager_user, leave_type = _setup()
    data = submit(_client(user), off_days(2)).json()["data"]

    response = _client(manager_user).post(
        f"/api/v1/requests/{data['approval_request_id']}/approve",
        {"note": "ok", "data": {"leave_type_id": leave_type.pk}},
        format="json",
    )

    assert response.status_code == 200
    assert LeaveBalance.objects.get(employee=employee, leave_type=leave_type).allocated == 2


# ------------------------------ leave type housekeeping ---------------------------------


def test_a_leave_type_credited_by_a_comp_off_request_cannot_be_deleted():
    user, _, manager_user, leave_type = _setup()
    row = CompOffRequest.objects.get(pk=submit(_client(user), off_days(1)).json()["data"]["id"])
    approve(row, manager_user, leave_type)
    hr = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr)

    response = _client(hr).delete(f"/api/v1/leave/types/{leave_type.pk}")

    assert response.status_code == 409
    assert LeaveType.objects.filter(pk=leave_type.pk).exists()


def test_purging_a_leave_type_removes_its_comp_off_requests_and_approvals():
    from approvals.models import Request as ApprovalRequest

    user, _, manager_user, leave_type = _setup()
    data = submit(_client(user), off_days(1)).json()["data"]
    approve(CompOffRequest.objects.get(), manager_user, leave_type)
    hr = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr)

    response = _client(hr).post(
        f"/api/v1/leave/types/{leave_type.pk}/purge",
        {"confirm_name": leave_type.name},
        format="json",
    )

    assert response.status_code == 200
    assert not CompOffRequest.objects.exists()
    assert not ApprovalRequest.objects.filter(pk=data["approval_request_id"]).exists()
