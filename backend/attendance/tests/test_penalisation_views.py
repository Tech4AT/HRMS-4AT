from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import PenalisationRecord, PenalisationStatus
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from notifications.models import Notification

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/attendance/penalisations"
MINE_URL = "/api/v1/attendance/penalisations/mine"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _hr_client():
    return _client("HR Admin")


def _record(employee, **overrides):
    defaults = {
        "absent_date": date(2026, 3, 1),
        "regularisation_deadline": date(2026, 3, 4),
        "days_overdue": 5,
        "reason": "No regularisation request submitted within 3 day(s) of the unexplained absence.",
    }
    defaults.update(overrides)
    return PenalisationRecord.objects.create(employee=employee, **defaults)


def test_list_anonymous_is_401():
    assert APIClient().get(LIST_URL).status_code == 401


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_list_roles_without_penalisation_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(LIST_URL).status_code == 403
    assert client.post(f"{LIST_URL}/1/overturn", {"reason": "x"}, format="json").status_code == 403


def test_hr_admin_sees_every_employees_records():
    employee_a = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    employee_b = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    _record(employee_a)
    _record(employee_b, absent_date=date(2026, 3, 5), regularisation_deadline=date(2026, 3, 8))
    client, _ = _hr_client()

    response = client.get(LIST_URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert {row["employeeId"] for row in data} == {str(employee_a.pk), str(employee_b.pk)}
    assert data[0]["reason"]
    assert data[0]["status"] == "applied"


def test_status_filter():
    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    applied = _record(employee)
    overturned = _record(
        employee,
        absent_date=date(2026, 3, 10),
        regularisation_deadline=date(2026, 3, 13),
        status=PenalisationStatus.OVERTURNED,
        overturned_reason="Waived",
    )
    client, _ = _hr_client()

    response = client.get(f"{LIST_URL}?status=overturned")

    ids = {row["id"] for row in response.json()["data"]}
    assert ids == {str(overturned.pk)}
    assert str(applied.pk) not in ids


def test_overturn_updates_status_writes_audit_and_notifies():
    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    record = _record(employee)
    client, _ = _hr_client()

    response = client.post(
        f"{LIST_URL}/{record.pk}/overturn", {"reason": "Was hospitalized"}, format="json"
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "overturned"
    assert data["overturnedReason"] == "Was hospitalized"
    assert data["overturnedBy"]
    record.refresh_from_db()
    assert record.status == PenalisationStatus.OVERTURNED
    assert AuditLog.objects.filter(
        action="PenalisationRecord.overturned", entity_id=str(record.pk)
    ).exists()
    assert Notification.objects.filter(user=employee.user, type="penalisation.overturned").exists()


def test_overturn_credits_back_the_deducted_leave():
    from decimal import Decimal

    from leave.balances import get_or_seed_balance
    from leave.models import LeaveType

    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    balance, _created = get_or_seed_balance(employee, leave_type, "2026")
    balance.used = Decimal("3")
    balance.save(update_fields=["used"])
    record = _record(employee, leave_days_deducted=Decimal("1"), leave_balance=balance)
    client, _ = _hr_client()

    response = client.post(f"{LIST_URL}/{record.pk}/overturn", {"reason": "Waived"}, format="json")

    assert response.status_code == 200
    balance.refresh_from_db()
    assert balance.used == Decimal("2")
    assert AuditLog.objects.filter(
        action="LeaveBalance.penalisation_reversed", entity_id=str(balance.pk)
    ).exists()


def test_overturn_with_no_deduction_does_not_touch_any_balance():
    from leave.models import LeaveBalance

    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    record = _record(employee)  # leave_days_deducted defaults to 0, leave_balance None
    client, _ = _hr_client()

    response = client.post(f"{LIST_URL}/{record.pk}/overturn", {"reason": "Waived"}, format="json")

    assert response.status_code == 200
    assert not LeaveBalance.objects.exists()


def test_overturn_requires_a_reason():
    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    record = _record(employee)
    client, _ = _hr_client()

    response = client.post(f"{LIST_URL}/{record.pk}/overturn", {"reason": ""}, format="json")

    assert response.status_code == 400
    record.refresh_from_db()
    assert record.status == PenalisationStatus.APPLIED


def test_cannot_overturn_an_already_overturned_record():
    employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    record = _record(
        employee, status=PenalisationStatus.OVERTURNED, overturned_reason="already done"
    )
    client, _ = _hr_client()

    response = client.post(f"{LIST_URL}/{record.pk}/overturn", {"reason": "again"}, format="json")

    assert response.status_code == 400


def test_overturn_unknown_record_is_404():
    client, _ = _hr_client()

    response = client.post(f"{LIST_URL}/999999/overturn", {"reason": "x"}, format="json")

    assert response.status_code == 404


def test_mine_anonymous_is_401():
    assert APIClient().get(MINE_URL).status_code == 401


def test_mine_no_employee_record_is_403():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.get(MINE_URL).status_code == 403


def test_mine_only_returns_the_callers_own_records():
    client, own_employee = _client("Employee")
    other_employee = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    _record(own_employee)
    _record(other_employee, absent_date=date(2026, 3, 5), regularisation_deadline=date(2026, 3, 8))

    response = client.get(MINE_URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["employeeId"] == str(own_employee.pk)


def test_mine_has_no_write_action():
    client, employee = _client("Employee")
    record = _record(employee)

    # Employees have no overturn action reachable at all — penalisation.manage
    # is HR-only, and MyPenalisationsView (mine) defines GET only.
    assert (
        client.post(
            f"{LIST_URL}/{record.pk}/overturn", {"reason": "please"}, format="json"
        ).status_code
        == 403
    )
    assert client.post(MINE_URL, {}, format="json").status_code == 405
