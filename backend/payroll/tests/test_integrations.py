"""Payroll wired to the other HRMS modules copied onto this branch:
attendance/leave/org_calendar (attendance source), the approvals engine
(shared Approvals inbox) and notifications. Expected values are worked out by
hand in each test."""

import datetime
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from approvals.models import Request
from attendance.models import AttendanceRecord
from employees.models import Employee
from leave.models import LeaveRequest, LeaveType
from notifications.models import Notification
from org_calendar.models import CalendarEntry
from payroll import models as m
from payroll.services import periods as period_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    with override_settings(DEBUG=True):
        call_command("seed_payroll", "--demo", verbosity=0)


def client_for(email):
    client = APIClient()
    client.force_authenticate(User.objects.get(email=email))
    return client


def ok(response, status=200):
    assert response.status_code == status, response.content
    return response.json()["data"]


def test_attendance_source_builds_payable_days_and_lop(seeded):
    """August 2026: 31 days, 10 weekend days (Sat/Sun), 1 holiday (14 Aug)
    -> 20 working days. Nikhil: 1 absent, 1 unpaid leave, 1 paid leave,
    1 half day, the rest present -> LOP 2.5, paid leave 1, present 16.5."""
    admin_user = User.objects.get(email="payroll.admin@demo.4at")
    nikhil = Employee.objects.get(employee_code="4AT-002")
    CalendarEntry.objects.create(
        type="holiday", date=datetime.date(2026, 8, 14), name="Test holiday"
    )
    unpaid = LeaveType.objects.create(name="Unpaid Leave", is_paid=False)
    paid = LeaveType.objects.create(name="Casual Leave", is_paid=True)
    for leave_type, day in ((unpaid, 4), (paid, 5)):
        LeaveRequest.objects.create(
            employee=nikhil,
            leave_type=leave_type,
            start_date=datetime.date(2026, 8, day),
            end_date=datetime.date(2026, 8, day),
            status="approved",
            duration_days=1,
            financial_year="2026",
        )
    day = datetime.date(2026, 8, 1)
    while day.month == 8:
        if day.weekday() < 5 and day.day not in (4, 5, 14):
            status = {3: "absent", 6: "half_day"}.get(day.day, "present")
            AttendanceRecord.objects.create(
                employee=nikhil,
                attendance_date=day,
                status=status,
                overtime_minutes=120 if day.day == 7 else None,
            )
        day += datetime.timedelta(days=1)

    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    period = period_service.create_period(group, 2026, 8, admin_user)
    assert period_service._attendance_provider() is not None
    period_service.sync_attendance(period, admin_user)

    row = m.AttendancePayrollInput.objects.get(period=period, employee=nikhil)
    assert row.source == "attendance_module"
    assert row.working_days == Decimal("31")  # calendar-days proration basis
    assert row.lop_days == Decimal("2.5")
    assert row.payable_days == Decimal("28.5")
    assert row.paid_leave_days == Decimal("1")
    assert row.unpaid_leave_days == Decimal("1")
    assert row.present_days == Decimal("16.5")
    assert row.ot_hours == Decimal("2.00")
    assert row.status == "final"
    # Someone with no attendance marked is not assumed absent: pending, no LOP.
    other = m.AttendancePayrollInput.objects.get(period=period, employee__employee_code="4AT-001")
    assert other.status == "pending" and other.lop_days == 0


def _submitted_run(admin):
    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    pid = ok(
        admin.post(
            "/api/v1/payroll/periods/",
            {"pay_group": str(group.pk), "year": 2026, "month": 9},
            format="json",
        ),
        201,
    )["id"]
    admin.post(f"/api/v1/payroll/periods/{pid}/attendance/fill-missing/", {}, format="json")
    run = ok(admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json"), 201)
    for exc in ok(admin.get(f"/api/v1/payroll/runs/{run['id']}/exceptions/?severity=warning")):
        admin.post(
            f"/api/v1/payroll/exceptions/{exc['id']}/acknowledge/", {"note": "ok"}, format="json"
        )
    ok(admin.post(f"/api/v1/payroll/runs/{run['id']}/submit/", {}, format="json"))
    return run["id"]


def test_payroll_run_approvals_flow_through_the_shared_inbox(seeded):
    admin = client_for("payroll.admin@demo.4at")
    reviewer_user = User.objects.get(email="finance.reviewer@demo.4at")
    approver_user = User.objects.get(email="payroll.approver@demo.4at")
    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    group.finance_reviewer = reviewer_user
    group.final_approver = approver_user
    group.save()
    run_id = _submitted_run(admin)

    # Finance Review is in the reviewer's shared Approvals inbox
    inbox = Request.objects.get(request_type="payroll_run", status="pending")
    assert inbox.approver == reviewer_user and inbox.requester.email == "payroll.admin@demo.4at"
    assert inbox.payload["stage"] == "finance_review"
    assert Notification.objects.filter(user=reviewer_user).exists()

    # Approving in the inbox advances payroll and opens Final Approval
    reviewer = client_for("finance.reviewer@demo.4at")
    assert (
        reviewer.post(
            f"/api/v1/requests/{inbox.pk}/approve", {"note": "Checked"}, format="json"
        ).status_code
        == 200
    )
    stages = {a.stage: a.status for a in m.PayrollApproval.objects.filter(run_id=run_id)}
    assert stages["finance_review"] == "approved" and stages["final_approval"] == "pending"
    final = Request.objects.get(request_type="payroll_run", status="pending")
    assert final.approver == approver_user and final.payload["stage"] == "final_approval"

    # Deciding inside Payroll resolves the matching inbox request
    approver = client_for("payroll.approver@demo.4at")
    ok(
        approver.post(
            f"/api/v1/payroll/runs/{run_id}/approvals/", {"decision": "approve"}, format="json"
        )
    )
    final.refresh_from_db()
    assert final.status == "approved"
    assert m.PayrollRun.objects.get(pk=run_id).status == "approved"

    # Finalize + release notifies the preparer and each employee
    ok(approver.post(f"/api/v1/payroll/runs/{run_id}/finalize/", {}, format="json"))
    assert Notification.objects.filter(
        user__email="payroll.admin@demo.4at", type="payroll.run_finalized"
    ).exists()
    ok(admin.post(f"/api/v1/payroll/runs/{run_id}/payslips/generate/", {}, format="json"))
    ok(admin.post(f"/api/v1/payroll/runs/{run_id}/payslips/release/", {}, format="json"))
    assert Notification.objects.filter(
        user__email="nikhil.kommineni@demo.4at", type="payroll.payslip_released"
    ).exists()


def test_inbox_approver_is_picked_when_none_is_named(seeded):
    admin = client_for("payroll.admin@demo.4at")
    _submitted_run(admin)
    inbox = Request.objects.get(request_type="payroll_run", status="pending")
    # first eligible holder of payroll.review who is not the preparer
    assert inbox.approver.email == "finance.reviewer@demo.4at"


def test_salary_revision_rejected_in_the_inbox(seeded):
    admin = client_for("payroll.admin@demo.4at")
    nikhil = Employee.objects.get(employee_code="4AT-002")
    structure = m.SalaryStructure.objects.get(code="GS-IND-001")
    revision = ok(
        admin.post(
            "/api/v1/payroll/compensations/",
            {
                "employee": nikhil.pk,
                "structure": str(structure.pk),
                "annual_ctc": 1440000,
                "effective_from": "2026-10-01",
                "reason": "Appraisal",
                "submit": True,
            },
            format="json",
        ),
        201,
    )
    inbox = Request.objects.get(request_type="salary_revision", status="pending")
    assert inbox.payload["revision_id"] == revision["id"]

    reviewer = client_for("finance.reviewer@demo.4at")
    response = reviewer.post(
        f"/api/v1/requests/{inbox.pk}/reject", {"note": "Budget freeze"}, format="json"
    )
    assert response.status_code == 200
    rev = m.CompensationRevision.objects.get(pk=revision["id"])
    assert rev.status == "rejected"
    assert rev.approvals.get(stage="finance_review").comments == "Budget freeze"
    assert not m.EmployeeCompensation.objects.filter(employee=nikhil, annual_ctc=1440000).exists()


def test_cancelling_a_revision_withdraws_its_inbox_request(seeded):
    admin = client_for("payroll.admin@demo.4at")
    nikhil = Employee.objects.get(employee_code="4AT-002")
    structure = m.SalaryStructure.objects.get(code="GS-IND-001")
    revision = ok(
        admin.post(
            "/api/v1/payroll/compensations/",
            {
                "employee": nikhil.pk,
                "structure": str(structure.pk),
                "annual_ctc": 1300000,
                "effective_from": "2026-10-01",
                "submit": True,
            },
            format="json",
        ),
        201,
    )
    ok(
        admin.post(
            f"/api/v1/payroll/compensations/{revision['id']}/cancel/",
            {"reason": "x"},
            format="json",
        )
    )
    assert Request.objects.get(request_type="salary_revision").status == "withdrawn"


def test_inbox_decision_refused_by_payroll_rules_keeps_both_sides_consistent(seeded):
    """HR can force-resolve any inbox request, but HR Admin does not hold the
    Finance Review permission: payroll refuses, and the inbox request goes
    back to pending instead of showing "approved" while payroll is pending."""
    admin = client_for("payroll.admin@demo.4at")
    run_id = _submitted_run(admin)
    inbox = Request.objects.get(request_type="payroll_run", status="pending")
    hr = client_for("hr.admin@demo.4at")
    response = hr.post(
        f"/api/v1/requests/{inbox.pk}/resolve", {"status": "approved"}, format="json"
    )
    assert response.status_code == 403
    assert "Payroll:" in response.json()["error"]["message"]
    inbox.refresh_from_db()
    assert inbox.status == "pending" and inbox.decided_by is None
    stage = m.PayrollApproval.objects.get(run_id=run_id, stage="finance_review")
    assert stage.status == "pending"


def test_final_approval_prefers_the_payroll_approver_role():
    """An HR Admin created before the Payroll Approver also holds
    payroll.approve; the Final Approval request must still go to the
    dedicated Payroll Approver role (as with a real employee directory)."""
    from accounts.models import Role

    early_hr = User.objects.create_user(
        username="early.hr",
        email="early.hr@example.com",
        password="x",
    )
    early_hr.roles.add(Role.objects.get(name="HR Admin"))
    Employee.objects.create(user=early_hr, employee_code="EARLY-HR")
    with override_settings(DEBUG=True):
        call_command("seed_payroll", "--demo", verbosity=0)
    admin = client_for("payroll.admin@demo.4at")
    run_id = _submitted_run(admin)
    reviewer = client_for("finance.reviewer@demo.4at")
    ok(
        reviewer.post(
            f"/api/v1/payroll/runs/{run_id}/approvals/", {"decision": "approve"}, format="json"
        )
    )
    final = Request.objects.get(request_type="payroll_run", status="pending")
    assert final.payload["stage"] == "final_approval"
    assert final.approver.email == "payroll.approver@demo.4at"
