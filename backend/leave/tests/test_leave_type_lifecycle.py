"""Leave type lifecycle: delete what is unused, deactivate what has history, and
the deliberate purge that erases a type together with its records."""

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from approvals.models import Request as ApprovalRequest
from attendance.models import PolicySettings
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from leave.models import LeaveBalance, LeaveRequest, LeaveType

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/types"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user, employee


def _used_type(name="Casual Leave", balances=2, with_request=True):
    """A type with `balances` balances and (optionally) one request that has an
    approval row behind it."""
    leave_type = LeaveType.objects.create(name=name, annual_allocation=Decimal("12"))
    people = [EmployeeFactory() for _ in range(balances)]
    for person in people:
        LeaveBalance.objects.create(employee=person, leave_type=leave_type, financial_year="2026")
    approval = None
    if with_request:
        requester = people[0] if people else EmployeeFactory()
        approval = ApprovalRequest.objects.create(
            request_type="leave", requester=requester.user, payload={"leave_type": name}
        )
        LeaveRequest.objects.create(
            employee=requester,
            leave_type=leave_type,
            start_date=date(2026, 3, 2),
            end_date=date(2026, 3, 2),
            duration_days=Decimal("1"),
            financial_year="2026",
            approval_request=approval,
        )
    return leave_type, approval


# --- delete: only what is unused ------------------------------------------------------------


def test_an_unused_type_can_be_permanently_deleted():
    hr, _, _ = _client("HR Admin")
    leave_type = LeaveType.objects.create(name="Sabbatical", annual_allocation=0)

    response = hr.delete(f"{URL}/{leave_type.pk}")

    assert response.status_code == 200
    assert not LeaveType.objects.filter(pk=leave_type.pk).exists()
    assert AuditLog.objects.filter(action="LeaveType.deleted").exists()


def test_a_used_type_is_not_deleted_and_the_reply_says_what_uses_it():
    hr, _, _ = _client("HR Admin")
    leave_type, _ = _used_type(balances=3)

    response = hr.delete(f"{URL}/{leave_type.pk}")

    assert response.status_code == 409
    message = response.json()["error"]["message"]
    assert "3 balance(s)" in message and "1 request(s)" in message and "deactivate" in message
    assert LeaveType.objects.filter(pk=leave_type.pk).exists()
    assert LeaveBalance.objects.filter(leave_type=leave_type).count() == 3


# --- usage counts ---------------------------------------------------------------------------


def test_leave_admins_see_how_much_each_type_is_used():
    hr, _, _ = _client("HR Admin")
    used, _ = _used_type("Casual Leave", balances=3)
    LeaveType.objects.create(name="Sabbatical", annual_allocation=0)

    rows = {r["name"]: r for r in hr.get(URL).json()["data"]}

    assert (rows["Casual Leave"]["balance_count"], rows["Casual Leave"]["request_count"]) == (3, 1)
    assert (rows["Sabbatical"]["balance_count"], rows["Sabbatical"]["request_count"]) == (0, 0)
    assert hr.get(f"{URL}/{used.pk}").json()["data"]["balance_count"] == 3


def test_other_employees_do_not_get_usage_counts():
    employee, _, _ = _client("Employee")
    _used_type(balances=5)

    row = employee.get(URL).json()["data"][0]

    assert row["balance_count"] is None and row["request_count"] is None


def test_a_freshly_created_type_reports_zero_usage_to_its_creator():
    hr, _, _ = _client("HR Admin")

    data = hr.post(URL, {"name": "New Type", "annual_allocation": 1}, format="json").json()["data"]

    assert (data["balance_count"], data["request_count"], data["status"]) == (0, 0, "active")


# --- deactivate / reactivate ----------------------------------------------------------------


def test_deactivating_keeps_every_balance_and_request_and_reactivating_restores_it():
    hr, _, _ = _client("HR Admin")
    leave_type, _ = _used_type(balances=2)

    off = hr.put(f"{URL}/{leave_type.pk}", {"status": "inactive"}, format="json")
    assert off.status_code == 200 and off.json()["data"]["status"] == "inactive"
    assert LeaveBalance.objects.filter(leave_type=leave_type).count() == 2
    assert LeaveRequest.objects.filter(leave_type=leave_type).count() == 1

    on = hr.put(f"{URL}/{leave_type.pk}", {"status": "active"}, format="json")
    assert on.status_code == 200 and on.json()["data"]["status"] == "active"


def test_an_invalid_status_is_refused():
    hr, _, _ = _client("HR Admin")
    leave_type, _ = _used_type()

    assert (
        hr.put(f"{URL}/{leave_type.pk}", {"status": "archived"}, format="json").status_code == 400
    )


def test_only_leave_admins_can_change_status():
    employee, _, _ = _client("Employee")
    leave_type, _ = _used_type()

    assert (
        employee.put(f"{URL}/{leave_type.pk}", {"status": "inactive"}, format="json").status_code
        == 403
    )
    leave_type.refresh_from_db()
    assert leave_type.status == "active"


def test_a_deactivated_type_cannot_be_used_for_a_new_request():
    employee, _, person = _client("Employee")
    leave_type = LeaveType.objects.create(
        name="Old Leave", annual_allocation=Decimal("5"), status="inactive"
    )

    response = employee.post(
        "/api/v1/leave/requests",
        {
            "leave_type_id": leave_type.pk,
            "start_date": "2030-03-04",
            "end_date": "2030-03-04",
            "half_day_option": "full_day",
        },
        format="json",
    )

    assert response.status_code == 400
    assert not LeaveRequest.objects.filter(employee=person).exists()


def test_deactivation_is_refused_while_the_attendance_policy_uses_the_type():
    hr, _, _ = _client("HR Admin")
    leave_type = LeaveType.objects.create(name="Penalty Leave", annual_allocation=0)
    policy = PolicySettings.load()
    policy.penalty_leave_type = leave_type
    policy.save()

    response = hr.put(f"{URL}/{leave_type.pk}", {"status": "inactive"}, format="json")

    assert response.status_code == 409
    assert "No Attendance penalty" in response.json()["error"]["message"]
    leave_type.refresh_from_db()
    assert leave_type.status == "active"


# --- purge ----------------------------------------------------------------------------------


def test_purge_erases_the_type_its_balances_requests_and_approvals_and_audits_the_counts():
    hr, _, _ = _client("HR Admin")
    leave_type, approval = _used_type("Casual Leave", balances=3)
    other, _ = _used_type("Sick Leave", balances=1)

    response = hr.post(
        f"{URL}/{leave_type.pk}/purge", {"confirm_name": "Casual Leave"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["data"] == {
        "id": str(leave_type.pk),
        "balances": 3,
        "requests": 1,
        "approvals": 1,
    }
    assert not LeaveType.objects.filter(pk=leave_type.pk).exists()
    assert not LeaveBalance.objects.filter(leave_type_id=leave_type.pk).exists()
    assert not LeaveRequest.objects.filter(leave_type_id=leave_type.pk).exists()
    assert not ApprovalRequest.objects.filter(pk=approval.pk).exists()
    # Another type's records are untouched.
    assert LeaveBalance.objects.filter(leave_type=other).count() == 1
    assert LeaveRequest.objects.filter(leave_type=other).count() == 1
    entry = AuditLog.objects.get(action="LeaveType.purged")
    assert entry.diff == {"name": "Casual Leave", "balances": 3, "requests": 1, "approvals": 1}


@pytest.mark.parametrize(
    "body", [{}, {"confirm_name": ""}, {"confirm_name": "casual leave"}, {"confirm_name": "Casual"}]
)
def test_purge_needs_the_exact_type_name(body):
    hr, _, _ = _client("HR Admin")
    leave_type, _ = _used_type("Casual Leave")

    response = hr.post(f"{URL}/{leave_type.pk}/purge", body, format="json")

    assert response.status_code == 400
    assert LeaveType.objects.filter(pk=leave_type.pk).exists()
    assert LeaveBalance.objects.filter(leave_type=leave_type).exists()


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_only_leave_admins_can_purge(role):
    client, _, _ = _client(role)
    leave_type, _ = _used_type("Casual Leave")

    response = client.post(
        f"{URL}/{leave_type.pk}/purge", {"confirm_name": "Casual Leave"}, format="json"
    )

    assert response.status_code == 403
    assert LeaveType.objects.filter(pk=leave_type.pk).exists()


def test_purge_of_an_unused_type_works_too():
    hr, _, _ = _client("HR Admin")
    leave_type = LeaveType.objects.create(name="Sabbatical", annual_allocation=0)

    response = hr.post(
        f"{URL}/{leave_type.pk}/purge", {"confirm_name": "Sabbatical"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["data"]["balances"] == 0
    assert not LeaveType.objects.filter(pk=leave_type.pk).exists()


def test_purge_leaves_policy_settings_and_penalisation_history_intact_with_the_link_cleared():
    hr, _, _ = _client("HR Admin")
    leave_type, _ = _used_type("Casual Leave", balances=1)
    policy = PolicySettings.load()
    policy.penalty_leave_type = leave_type
    policy.save()

    response = hr.post(
        f"{URL}/{leave_type.pk}/purge", {"confirm_name": "Casual Leave"}, format="json"
    )

    assert response.status_code == 200
    policy.refresh_from_db()
    assert policy.penalty_leave_type_id is None


def test_purge_of_a_missing_type_is_a_404():
    hr, _, _ = _client("HR Admin")

    assert hr.post(f"{URL}/999999/purge", {"confirm_name": "x"}, format="json").status_code == 404
