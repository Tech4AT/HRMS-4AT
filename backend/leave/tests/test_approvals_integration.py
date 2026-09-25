"""Same proof as attendance/tests/test_approvals_integration.py and
example_leave's: raising a request routes to the manager, and the manager's
decision through the generic engine flows back via request_decided
(handlers.py) — this app never exposes its own approve/reject endpoint. Also
covers the balance pending->used/released bookkeeping, which is this module's
own effect to apply (the engine has no idea balances exist)."""

from decimal import Decimal

import pytest

from accounts.models import User
from approvals import service as approvals
from approvals.models import RequestStatus
from employees.models import Employee
from leave.models import LeaveBalance, LeaveRequest, LeaveRequestStatus, LeaveType


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


def _pair(manager_email, employee_email, manager_code, employee_code):
    manager = _user(manager_email)
    mgr_emp = Employee.objects.create(user=manager, employee_code=manager_code)
    emp_user = _user(employee_email)
    Employee.objects.create(user=emp_user, employee_code=employee_code, manager=mgr_emp)
    return manager, emp_user


def _leave_setup(employee, *, allocation="6"):
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal(allocation)
    )
    balance = LeaveBalance.objects.create(
        employee=employee.employee,
        leave_type=leave_type,
        financial_year="2026",
        allocated=Decimal(allocation),
    )
    row = LeaveRequest.objects.create(
        employee=employee.employee,
        leave_type=leave_type,
        start_date="2026-03-02",
        end_date="2026-03-04",
        duration_days=Decimal("3"),
        financial_year="2026",
    )
    balance.pending = Decimal("3")
    balance.save(update_fields=["pending"])
    return leave_type, balance, row


@pytest.mark.django_db
def test_approval_flows_back_and_moves_pending_to_used():
    manager, emp_user = _pair("lv-mgr@x.com", "lv-emp@x.com", "LM1", "LE1")
    _leave_type, balance, row = _leave_setup(emp_user)
    req = approvals.create_request(emp_user, "leave", {"leave_request_id": row.pk})
    assert req.approver_id == manager.pk

    approvals.decide(req, manager, RequestStatus.APPROVED, "enjoy")

    row.refresh_from_db()
    balance.refresh_from_db()
    assert row.status == LeaveRequestStatus.APPROVED
    assert balance.used == Decimal("3")
    assert balance.pending == Decimal("0")


@pytest.mark.django_db
def test_rejection_releases_the_pending_hold_without_deducting():
    manager, emp_user = _pair("lv-mgr2@x.com", "lv-emp2@x.com", "LM2", "LE2")
    _leave_type, balance, row = _leave_setup(emp_user)
    req = approvals.create_request(emp_user, "leave", {"leave_request_id": row.pk})

    approvals.decide(req, manager, RequestStatus.REJECTED, "no coverage")

    row.refresh_from_db()
    balance.refresh_from_db()
    assert row.status == LeaveRequestStatus.REJECTED
    assert balance.used == Decimal("0")
    assert balance.pending == Decimal("0")


@pytest.mark.django_db
def test_withdrawal_releases_the_pending_hold():
    manager, emp_user = _pair("lv-mgr3@x.com", "lv-emp3@x.com", "LM3", "LE3")
    _leave_type, balance, row = _leave_setup(emp_user)
    req = approvals.create_request(emp_user, "leave", {"leave_request_id": row.pk})

    approvals.withdraw(req, emp_user)

    row.refresh_from_db()
    balance.refresh_from_db()
    assert row.status == LeaveRequestStatus.CANCELLED
    assert balance.pending == Decimal("0")


@pytest.mark.django_db
def test_a_decision_for_another_modules_request_type_is_ignored():
    manager, emp_user = _pair("lv-mgr4@x.com", "lv-emp4@x.com", "LM4", "LE4")
    req = approvals.create_request(
        emp_user, "attendance_regularization", {"attendance_request_id": 1}
    )

    approvals.decide(req, manager, RequestStatus.APPROVED)  # must not raise

    assert not LeaveRequest.objects.exists()
