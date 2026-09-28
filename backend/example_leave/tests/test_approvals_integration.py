"""APP-4 proof: creating a leave request raises an approvals Request routed to
the manager, and the manager's decision flows back to the LeaveRequest via the
request_decided signal — the module never touches the approvals endpoint."""

import pytest

from accounts.models import User
from approvals import service as approvals
from approvals.models import Request, RequestStatus
from employees.models import Employee
from example_leave.models import LeaveRequest


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


@pytest.mark.django_db
def test_leave_decision_flows_back_through_the_signal():
    manager = _user("mgr@x.com")
    mgr_emp = Employee.objects.create(user=manager, employee_code="LM1")
    emp_user = _user("emp@x.com")
    Employee.objects.create(user=emp_user, employee_code="LE1", manager=mgr_emp)

    leave = LeaveRequest.objects.create(
        employee=emp_user.employee, reason="Family event", status="pending"
    )
    req = approvals.create_request(
        emp_user, "example_leave", {"leave_request_id": leave.pk, "reason": leave.reason}
    )
    assert req.approver_id == manager.pk  # routed to the manager

    approvals.decide(req, manager, RequestStatus.APPROVED, "ok")
    leave.refresh_from_db()
    assert leave.status == "approved"  # applied via request_decided (handlers.py)


@pytest.mark.django_db
def test_rejection_flows_back():
    manager = _user("mgr2@x.com")
    mgr_emp = Employee.objects.create(user=manager, employee_code="LM2")
    emp_user = _user("emp2@x.com")
    Employee.objects.create(user=emp_user, employee_code="LE2", manager=mgr_emp)

    leave = LeaveRequest.objects.create(employee=emp_user.employee, status="pending")
    req = approvals.create_request(emp_user, "example_leave", {"leave_request_id": leave.pk})
    approvals.decide(req, manager, RequestStatus.REJECTED)
    leave.refresh_from_db()
    assert leave.status == "rejected"
    assert Request.objects.filter(pk=req.pk, status="rejected").exists()
