"""PLAN.md Step 5 — the consolidated verification pass: Leave and Attendance
(WFH/Regularisation) requests, raised through their own real HTTP endpoints,
show up in the *generic* approvals inbox and decide correctly through the
generic endpoints — with no bespoke approve/reject endpoint in either module.
Also covers `approvals.manage`'s reassign/force-resolve escape hatch against a
real consumer request (not just a synthetic one), since that's the one part of
Step 5 no single module's own test suite exercises."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import AttendanceRecord, AttendanceRequestStatus, AttendanceStatus
from employees.factories import EmployeeFactory
from leave.models import LeaveRequestStatus, LeaveType

pytestmark = pytest.mark.django_db

INBOX_URL = "/api/v1/requests/"


def _client(role_name, manager=None):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, manager=manager)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee, user


def _manager():
    return _client("Manager")


def _hr_admin():
    return _client("HR Admin")


# ------------------------- appears in the generic inbox -----------------------


def test_leave_request_appears_in_the_generic_inbox_for_the_manager_only():
    manager_client, manager_employee, _manager_user = _manager()
    employee_client, employee, _emp_user = _client("Employee", manager=manager_employee)
    other_manager_client, _, _ = _manager()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)

    employee_client.post(
        "/api/v1/leave/requests",
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-04-06", "end_date": "2026-04-06"},
        format="json",
    )

    manager_inbox = manager_client.get(INBOX_URL).json()["data"]
    other_inbox = other_manager_client.get(INBOX_URL).json()["data"]

    assert any(r["request_type"] == "leave" for r in manager_inbox)
    assert other_inbox == []


def test_wfh_request_appears_in_the_generic_inbox():
    manager_client, manager_employee, _ = _manager()
    employee_client, _, _ = _client("Employee", manager=manager_employee)

    employee_client.post(
        "/api/v1/attendance/requests",
        {
            "request_type": "wfh",
            "start_date": "2026-04-06",
            "end_date": "2026-04-07",
            "reason": "x",
        },
        format="json",
    )

    inbox = manager_client.get(INBOX_URL).json()["data"]

    assert any(r["request_type"] == "wfh" for r in inbox)


# ------------------- decides through the generic endpoint, no bespoke one -----


def test_wfh_decided_through_the_generic_approve_endpoint_marks_the_day():
    manager_client, manager_employee, _ = _manager()
    employee_client, employee, _ = _client("Employee", manager=manager_employee)
    created = employee_client.post(
        "/api/v1/attendance/requests",
        {
            "request_type": "wfh",
            "start_date": "2026-04-06",
            "end_date": "2026-04-06",
            "reason": "x",
        },
        format="json",
    ).json()["data"]
    request_id = manager_client.get(INBOX_URL).json()["data"][0]["id"]

    response = manager_client.post(f"/api/v1/requests/{request_id}/approve", {}, format="json")

    assert response.status_code == 200
    own = employee_client.get("/api/v1/attendance/requests").json()["data"]
    assert own[0]["id"] == created["id"]
    assert own[0]["status"] == AttendanceRequestStatus.APPROVED
    record = AttendanceRecord.objects.get(employee=employee, attendance_date="2026-04-06")
    assert record.status == AttendanceStatus.WORK_FROM_HOME


def test_regularisation_decided_through_the_generic_reject_endpoint():
    manager_client, manager_employee, _ = _manager()
    employee_client, _, _ = _client("Employee", manager=manager_employee)
    employee_client.post(
        "/api/v1/attendance/requests",
        {"request_type": "regularisation", "start_date": "2026-04-06", "reason": "forgot"},
        format="json",
    )
    request_id = manager_client.get(INBOX_URL).json()["data"][0]["id"]

    response = manager_client.post(
        f"/api/v1/requests/{request_id}/reject", {"note": "no evidence"}, format="json"
    )

    assert response.status_code == 200
    own = employee_client.get("/api/v1/attendance/requests").json()["data"]
    assert own[0]["status"] == AttendanceRequestStatus.REJECTED
    assert own[0]["rejection_reason"] == "no evidence"


# ---------------------- approvals.manage's escape hatch, for real -------------


def test_hr_admin_force_resolves_a_leave_request_with_no_manager():
    hr_client, _, _ = _hr_admin()
    employee_client, employee, _ = _client("Employee")  # no manager -> unassigned approver
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    created = employee_client.post(
        "/api/v1/leave/requests",
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-04-06", "end_date": "2026-04-06"},
        format="json",
    ).json()["data"]

    # Unassigned — not in any manager's inbox, but HR Admin (approvals.manage) sees it.
    hr_inbox = hr_client.get(INBOX_URL).json()["data"]
    request_id = next(r["id"] for r in hr_inbox if r["request_type"] == "leave")

    response = hr_client.post(
        f"/api/v1/requests/{request_id}/resolve",
        {"status": "approved", "note": "resolved by HR"},
        format="json",
    )

    assert response.status_code == 200
    from leave.models import LeaveRequest

    row = LeaveRequest.objects.get(pk=created["id"])
    assert row.status == LeaveRequestStatus.APPROVED


def test_hr_admin_reassigns_a_stuck_wfh_request_and_the_new_approver_can_decide():
    hr_client, _, _ = _hr_admin()
    new_approver_client, _, new_approver_user = _manager()
    employee_client, _, _ = _client("Employee")  # no manager -> unassigned approver
    employee_client.post(
        "/api/v1/attendance/requests",
        {
            "request_type": "wfh",
            "start_date": "2026-04-06",
            "end_date": "2026-04-06",
            "reason": "x",
        },
        format="json",
    )
    request_id = next(
        r["id"] for r in hr_client.get(INBOX_URL).json()["data"] if r["request_type"] == "wfh"
    )

    reassign_response = hr_client.post(
        f"/api/v1/requests/{request_id}/reassign",
        {"approver": new_approver_user.pk},
        format="json",
    )
    assert reassign_response.status_code == 200

    decide_response = new_approver_client.post(
        f"/api/v1/requests/{request_id}/approve", {}, format="json"
    )
    assert decide_response.status_code == 200
