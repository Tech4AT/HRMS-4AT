"""Same proof as example_leave/tests/test_approvals_integration.py: raising a
request routes to the manager, and the manager's decision through the generic
engine flows back via request_decided (handlers.py) — this app never exposes
its own approve/reject endpoint."""

import pytest

from accounts.models import User
from approvals import service as approvals
from approvals.models import RequestStatus
from attendance.models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceStatus,
)
from employees.models import Employee


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


def _pair(manager_email, employee_email, manager_code, employee_code):
    manager = _user(manager_email)
    mgr_emp = Employee.objects.create(user=manager, employee_code=manager_code)
    emp_user = _user(employee_email)
    Employee.objects.create(user=emp_user, employee_code=employee_code, manager=mgr_emp)
    return manager, emp_user


@pytest.mark.django_db
def test_wfh_approval_flows_back_and_marks_the_record():
    manager, emp_user = _pair("wfh-mgr@x.com", "wfh-emp@x.com", "WM1", "WE1")
    row = AttendanceRequest.objects.create(
        employee=emp_user.employee,
        request_type="wfh",
        start_date="2026-10-05",
        end_date="2026-10-06",
        reason="Home repairs",
    )
    req = approvals.create_request(
        emp_user, "wfh", {"attendance_request_id": row.pk, "start_date": "2026-10-05"}
    )
    assert req.approver_id == manager.pk

    approvals.decide(req, manager, RequestStatus.APPROVED, "ok")

    row.refresh_from_db()
    assert row.status == AttendanceRequestStatus.APPROVED
    records = AttendanceRecord.objects.filter(employee=emp_user.employee).order_by(
        "attendance_date"
    )
    assert [r.attendance_date.isoformat() for r in records] == ["2026-10-05", "2026-10-06"]
    assert all(r.status == AttendanceStatus.WORK_FROM_HOME for r in records)


@pytest.mark.django_db
def test_regularisation_approval_marks_present():
    manager, emp_user = _pair("reg-mgr@x.com", "reg-emp@x.com", "RM1", "RE1")
    row = AttendanceRequest.objects.create(
        employee=emp_user.employee,
        request_type="regularisation",
        start_date="2026-10-05",
        end_date="2026-10-05",
        reason="Forgot to clock in",
    )
    req = approvals.create_request(
        emp_user, "attendance_regularization", {"attendance_request_id": row.pk}
    )

    approvals.decide(req, manager, RequestStatus.APPROVED)

    row.refresh_from_db()
    record = AttendanceRecord.objects.get(employee=emp_user.employee, attendance_date="2026-10-05")
    assert record.status == AttendanceStatus.PRESENT


@pytest.mark.django_db
def test_approval_does_not_overwrite_an_existing_clock_in():
    manager, emp_user = _pair("keep-mgr@x.com", "keep-emp@x.com", "KM1", "KE1")
    from django.utils import timezone

    existing = AttendanceRecord.objects.create(
        employee=emp_user.employee,
        attendance_date="2026-10-05",
        clock_in_time=timezone.now(),
        status=AttendanceStatus.PRESENT,
    )
    row = AttendanceRequest.objects.create(
        employee=emp_user.employee,
        request_type="regularisation",
        start_date="2026-10-05",
        end_date="2026-10-05",
    )
    req = approvals.create_request(
        emp_user, "attendance_regularization", {"attendance_request_id": row.pk}
    )

    approvals.decide(req, manager, RequestStatus.APPROVED)

    existing.refresh_from_db()
    assert existing.status == AttendanceStatus.PRESENT  # unchanged, still self-marked


@pytest.mark.django_db
def test_rejection_flows_back_without_marking_any_record():
    manager, emp_user = _pair("rej-mgr@x.com", "rej-emp@x.com", "JM1", "JE1")
    row = AttendanceRequest.objects.create(
        employee=emp_user.employee,
        request_type="wfh",
        start_date="2026-10-05",
        end_date="2026-10-05",
    )
    req = approvals.create_request(emp_user, "wfh", {"attendance_request_id": row.pk})

    approvals.decide(req, manager, RequestStatus.REJECTED, "no coverage")

    row.refresh_from_db()
    assert row.status == AttendanceRequestStatus.REJECTED
    assert not AttendanceRecord.objects.filter(employee=emp_user.employee).exists()


@pytest.mark.django_db
def test_withdraw_flows_back_as_cancelled():
    manager, emp_user = _pair("wd-mgr@x.com", "wd-emp@x.com", "DM1", "DE1")
    row = AttendanceRequest.objects.create(
        employee=emp_user.employee,
        request_type="regularisation",
        start_date="2026-10-05",
        end_date="2026-10-05",
    )
    req = approvals.create_request(
        emp_user, "attendance_regularization", {"attendance_request_id": row.pk}
    )

    approvals.withdraw(req, emp_user)

    row.refresh_from_db()
    assert row.status == AttendanceRequestStatus.CANCELLED


@pytest.mark.django_db
def test_a_decision_for_another_modules_request_type_is_ignored():
    manager, emp_user = _pair("other-mgr@x.com", "other-emp@x.com", "OM1", "OE1")
    req = approvals.create_request(emp_user, "leave", {"leave_request_id": 999})

    # Must not raise, and must not touch anything in this app.
    approvals.decide(req, manager, RequestStatus.APPROVED)

    assert not AttendanceRequest.objects.exists()
