import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import AttendanceRequest
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

REQUESTS_URL = "/api/v1/attendance/requests"
PENDING_URL = f"{REQUESTS_URL}/approvals/pending"
HISTORY_URL = f"{REQUESTS_URL}/approvals/history"


def _employee_client(role_name="Employee", manager=None):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, manager=manager)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _manager():
    manager_client, manager_employee = _employee_client("Manager")
    return manager_client, manager_employee


def test_create_wfh_request_routes_to_the_employees_manager():
    manager_client, manager_employee = _manager()
    client, employee = _employee_client(manager=manager_employee)

    response = client.post(
        REQUESTS_URL,
        {
            "request_type": "wfh",
            "start_date": "2026-10-05",
            "end_date": "2026-10-06",
            "reason": "Home repairs",
        },
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "submitted"
    assert data["employee_id"] == str(employee.pk)

    row = AttendanceRequest.objects.get(pk=data["id"])
    assert row.approval_request is not None
    assert row.approval_request.approver_id == manager_employee.user_id
    assert row.approval_request.request_type == "wfh"


def test_create_regularisation_defaults_end_date_to_start_date():
    client, _ = _employee_client()

    response = client.post(
        REQUESTS_URL,
        {
            "request_type": "regularisation",
            "start_date": "2026-10-05",
            "reason": "Forgot to clock in",
        },
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["start_date"] == data["end_date"] == "2026-10-05"

    row = AttendanceRequest.objects.get(pk=data["id"])
    assert row.approval_request.request_type == "attendance_regularization"


def test_wfh_request_without_end_date_is_rejected():
    client, _ = _employee_client()

    response = client.post(
        REQUESTS_URL, {"request_type": "wfh", "start_date": "2026-10-05"}, format="json"
    )

    assert response.status_code == 400


def test_list_returns_only_the_callers_own_requests():
    client_a, employee_a = _employee_client()
    client_b, _ = _employee_client()
    client_a.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "x"},
        format="json",
    )

    response = client_b.get(REQUESTS_URL)

    assert response.json()["data"] == []
    assert AttendanceRequest.objects.get(employee=employee_a).employee_id == employee_a.pk


def test_update_a_pending_request():
    client, _ = _employee_client()
    created = client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "typo"},
        format="json",
    ).json()["data"]

    response = client.patch(
        f"{REQUESTS_URL}/{created['id']}", {"reason": "fixed reason"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["data"]["reason"] == "fixed reason"


def test_cannot_update_a_decided_request():
    manager_client, manager_employee = _manager()
    client, _ = _employee_client(manager=manager_employee)
    created = client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "x"},
        format="json",
    ).json()["data"]
    row = AttendanceRequest.objects.get(pk=created["id"])
    from approvals import service as approvals

    approvals.decide(row.approval_request, manager_employee.user, "approved")

    response = client.patch(f"{REQUESTS_URL}/{created['id']}", {"reason": "y"}, format="json")

    assert response.status_code == 400


def test_cancel_withdraws_the_request():
    client, _ = _employee_client()
    created = client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "x"},
        format="json",
    ).json()["data"]

    response = client.post(f"{REQUESTS_URL}/{created['id']}/cancel")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "cancelled"
    assert data["cancelled_at"] is not None


def test_approvals_pending_is_scoped_to_the_managers_reports_and_excludes_self():
    manager_client, manager_employee = _manager()
    report_client, report_employee = _employee_client(manager=manager_employee)
    other_client, _ = _employee_client()  # unrelated employee, different manager

    report_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "x"},
        format="json",
    )
    other_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "y"},
        format="json",
    )
    manager_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "z"},
        format="json",
    )

    response = manager_client.get(PENDING_URL)

    assert response.status_code == 200
    employee_ids = {row["employee_id"] for row in response.json()["data"]}
    assert employee_ids == {str(report_employee.pk)}


def test_approvals_pending_requires_attendance_approve():
    client, _ = _employee_client()  # plain Employee role holds no attendance.approve

    assert client.get(PENDING_URL).status_code == 403


def test_approvals_history_shows_decided_requests_not_pending_ones():
    from approvals import service as approvals

    manager_client, manager_employee = _manager()
    report_client, report_employee = _employee_client(manager=manager_employee)
    decided = report_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "decided one"},
        format="json",
    ).json()["data"]
    report_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-02", "reason": "still pending"},
        format="json",
    )
    row = AttendanceRequest.objects.get(pk=decided["id"])
    approvals.decide(row.approval_request, manager_employee.user, "approved", "ok")

    pending = manager_client.get(PENDING_URL).json()["data"]
    history = manager_client.get(HISTORY_URL).json()["data"]

    assert [r["reason"] for r in pending] == ["still pending"]
    assert [r["reason"] for r in history] == ["decided one"]
    assert history[0]["status"] == "approved"
    assert history[0]["approved_at"] is not None


def test_approvals_history_requires_attendance_approve():
    client, _ = _employee_client()

    assert client.get(HISTORY_URL).status_code == 403


def test_history_credits_whoever_actually_decided_it_not_the_routed_approver():
    """An HR Admin resolving a request via the approvals.manage override
    (force_resolve) is not who it was routed to — decided_by_name must credit
    the HR Admin, while approver_name keeps showing the original manager."""
    from approvals import service as approvals

    manager_client, manager_employee = _manager()
    hr_client, hr_employee = _employee_client("HR Admin")
    report_client, _ = _employee_client(manager=manager_employee)
    created = report_client.post(
        REQUESTS_URL,
        {"request_type": "regularisation", "start_date": "2026-10-01", "reason": "x"},
        format="json",
    ).json()["data"]
    row = AttendanceRequest.objects.get(pk=created["id"])
    approvals.force_resolve(row.approval_request, hr_employee.user, "approved", "hr override")

    history = manager_client.get(HISTORY_URL).json()["data"]

    assert history[0]["approver_name"] == manager_employee.user.get_username()
    assert history[0]["decided_by_name"] == hr_employee.user.get_username()
    assert history[0]["decided_by_name"] != history[0]["approver_name"]
