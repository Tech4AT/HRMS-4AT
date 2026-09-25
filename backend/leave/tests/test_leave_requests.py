import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from leave.models import LeaveRequest, LeaveType

pytestmark = pytest.mark.django_db

REQUESTS_URL = "/api/v1/leave/requests"
PENDING_URL = f"{REQUESTS_URL}/approvals/pending"
HISTORY_URL = f"{REQUESTS_URL}/approvals/history"


def _employee_client(role_name="Employee", manager=None):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, manager=manager)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _manager():
    return _employee_client("Manager")


def test_create_requires_approval_leaves_it_submitted_and_raises_a_request():
    manager_client, manager_employee = _manager()
    client, employee = _employee_client(manager=manager_employee)
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=6, requires_approval=True
    )

    response = client.post(
        REQUESTS_URL,
        {
            "leave_type_id": str(leave_type.pk),
            "start_date": "2026-03-02",
            "end_date": "2026-03-04",
            "reason": "Family trip",
        },
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "submitted"
    assert data["duration_days"] == "3.0"

    row = LeaveRequest.objects.get(pk=data["id"])
    assert row.approval_request is not None
    assert row.approval_request.approver_id == manager_employee.user_id


def test_create_without_approval_is_auto_approved_and_deducts_balance_immediately():
    client, employee = _employee_client()
    leave_type = LeaveType.objects.create(
        name="Comp Off", annual_allocation=5, requires_approval=False
    )

    response = client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "approved"
    assert data["approved_at"] is not None

    row = LeaveRequest.objects.get(pk=data["id"])
    assert row.approval_request is None  # never raised, per the auto-approve exemption

    balance_response = client.get("/api/v1/leave/balance")
    balance = next(
        b for b in balance_response.json()["data"] if b["leave_type_id"] == str(leave_type.pk)
    )
    assert balance["used"] == "1.0"
    assert balance["pending"] == "0.0"


def test_insufficient_balance_is_rejected_at_creation():
    client, _ = _employee_client()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=1)

    response = client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-05"},
        format="json",
    )

    assert response.status_code == 400


def test_list_returns_only_the_callers_own_requests():
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    client_a, employee_a = _employee_client()
    client_b, _ = _employee_client()
    client_a.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    )

    response = client_b.get(REQUESTS_URL)

    assert response.json()["data"] == []


def test_cancel_withdraws_a_pending_request():
    manager_client, manager_employee = _manager()
    client, _ = _employee_client(manager=manager_employee)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    created = client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    ).json()["data"]

    response = client.post(f"{REQUESTS_URL}/{created['id']}/cancel")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "cancelled"


def test_cannot_cancel_an_auto_approved_request():
    client, _ = _employee_client()
    leave_type = LeaveType.objects.create(
        name="Comp Off", annual_allocation=5, requires_approval=False
    )
    created = client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    ).json()["data"]

    response = client.post(f"{REQUESTS_URL}/{created['id']}/cancel")

    assert response.status_code == 400


def test_approvals_pending_is_scoped_to_the_managers_reports_and_excludes_self():
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    manager_client, manager_employee = _manager()
    report_client, report_employee = _employee_client(manager=manager_employee)

    report_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    )
    manager_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-09", "end_date": "2026-03-09"},
        format="json",
    )

    response = manager_client.get(PENDING_URL)

    employee_ids = {row["employee_id"] for row in response.json()["data"]}
    assert employee_ids == {str(report_employee.pk)}


def test_approvals_pending_requires_leave_approve():
    client, _ = _employee_client()

    assert client.get(PENDING_URL).status_code == 403


def test_approvals_history_shows_decided_requests_not_pending_ones():
    from approvals import service as approvals

    manager_client, manager_employee = _manager()
    report_client, report_employee = _employee_client(manager=manager_employee)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    decided = report_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    ).json()["data"]
    report_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-09", "end_date": "2026-03-09"},
        format="json",
    )
    row = LeaveRequest.objects.get(pk=decided["id"])
    approvals.decide(row.approval_request, manager_employee.user, "rejected", "no coverage")

    pending = manager_client.get(PENDING_URL).json()["data"]
    history = manager_client.get(HISTORY_URL).json()["data"]

    assert [r["start_date"] for r in pending] == ["2026-03-09"]
    assert [r["start_date"] for r in history] == ["2026-03-02"]
    assert history[0]["status"] == "rejected"
    assert history[0]["rejection_reason"] == "no coverage"


def test_approvals_history_requires_leave_approve():
    client, _ = _employee_client()

    assert client.get(HISTORY_URL).status_code == 403


def test_history_credits_whoever_actually_decided_it_not_the_routed_approver():
    """Same proof as attendance's identical test: HR Admin resolving via the
    approvals.manage override isn't who the request was routed to."""
    from approvals import service as approvals

    manager_client, manager_employee = _manager()
    hr_client, hr_employee = _employee_client("HR Admin")
    report_client, _ = _employee_client(manager=manager_employee)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    created = report_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    ).json()["data"]
    row = LeaveRequest.objects.get(pk=created["id"])
    approvals.force_resolve(row.approval_request, hr_employee.user, "approved", "hr override")

    history = manager_client.get(HISTORY_URL).json()["data"]

    assert history[0]["approver_name"] == manager_employee.user.get_username()
    assert history[0]["decided_by_name"] == hr_employee.user.get_username()
    assert history[0]["decided_by_name"] != history[0]["approver_name"]


def test_frontends_actual_pending_approvals_path_also_works():
    """lib/api/leave.ts's getPendingApprovals() calls `/leave/approvals/pending`
    (no `/requests/` segment) — a real path mismatch found during manual
    verification (it was 404ing). Same view as PENDING_URL, different route."""
    manager_client, manager_employee = _manager()
    report_client, report_employee = _employee_client(manager=manager_employee)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    report_client.post(
        REQUESTS_URL,
        {"leave_type_id": str(leave_type.pk), "start_date": "2026-03-02", "end_date": "2026-03-02"},
        format="json",
    )

    response = manager_client.get("/api/v1/leave/approvals/pending")

    assert response.status_code == 200
    assert any(r["employee_id"] == str(report_employee.pk) for r in response.json()["data"])
