from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceRequestType,
    PenalisationRecord,
    PenalisationStatus,
    PolicySettings,
)
from attendance.penalisation import apply_penalisations, apply_penalisations_for
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from notifications.models import Notification
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

TODAY = date(2026, 3, 20)  # a Friday — not a weekend, keeps the math simple


def _employee():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    employee = EmployeeFactory(user=user)
    make_calendar(employee)  # Saturday + Sunday off
    return employee


def test_creates_a_record_for_an_unexplained_absence_past_the_grace_period():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)  # well past the default 3-day grace

    created = apply_penalisations_for(employee, today=TODAY)

    assert created >= 1
    record = PenalisationRecord.objects.get(employee=employee, absent_date=absent_day)
    assert record.status == PenalisationStatus.APPLIED
    assert record.regularisation_deadline == absent_day + timedelta(days=3)
    assert record.days_overdue == (TODAY - record.regularisation_deadline).days
    assert "3" in record.reason
    # No penalty_leave_type configured (the default) - no deduction happens,
    # but the record itself still gets created.
    assert record.leave_days_deducted == Decimal("0")
    assert record.leave_balance is None


def test_does_not_penalise_within_the_grace_period():
    employee = _employee()
    recent_absence = TODAY - timedelta(days=1)  # within the 3-day grace window

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(
        employee=employee, absent_date=recent_absence
    ).exists()


def test_does_not_penalise_a_day_the_employee_clocked_in():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)
    AttendanceRecord.objects.create(
        employee=employee, attendance_date=absent_day, clock_in_time=f"{absent_day}T09:00:00+00:00"
    )

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_does_not_penalise_a_weekend_day():
    employee = _employee()
    # The employee's calendar has Sat/Sun off — find a Sunday inside the lookback
    # window instead of hardcoding an offset.
    sunday = TODAY - timedelta(days=10)
    while sunday.weekday() != 6:
        sunday -= timedelta(days=1)

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=sunday).exists()


def test_does_not_penalise_a_holiday():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)
    CalendarEntry.objects.create(
        calendar=employee.calendars.get(), type="holiday", date=absent_day, name="Test Holiday"
    )

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_does_not_penalise_a_day_on_approved_leave():
    from leave.models import LeaveRequest, LeaveRequestStatus, LeaveType

    employee = _employee()
    absent_day = TODAY - timedelta(days=10)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=absent_day,
        end_date=absent_day,
        duration_days=Decimal("1"),
        financial_year="2026",
        status=LeaveRequestStatus.APPROVED,
    )

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_does_not_penalise_a_day_covered_by_a_submitted_regularisation_request():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)
    AttendanceRequest.objects.create(
        employee=employee,
        request_type=AttendanceRequestType.REGULARISATION,
        start_date=absent_day,
        end_date=absent_day,
        status=AttendanceRequestStatus.SUBMITTED,
    )

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_a_cancelled_regularisation_request_does_not_exempt_the_day():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)
    AttendanceRequest.objects.create(
        employee=employee,
        request_type=AttendanceRequestType.REGULARISATION,
        start_date=absent_day,
        end_date=absent_day,
        status=AttendanceRequestStatus.CANCELLED,
    )

    apply_penalisations_for(employee, today=TODAY)

    assert PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_running_twice_does_not_double_apply():
    employee = _employee()

    first = apply_penalisations_for(employee, today=TODAY)
    second = apply_penalisations_for(employee, today=TODAY)

    assert first > 0
    assert second == 0


def test_respects_a_custom_grace_period():
    employee = _employee()
    PolicySettings.objects.update_or_create(pk=1, defaults={"regularisation_grace_days": 7})
    absent_day = TODAY - timedelta(days=5)  # past the default 3 days, not past 7

    apply_penalisations_for(employee, today=TODAY)

    assert not PenalisationRecord.objects.filter(employee=employee, absent_date=absent_day).exists()


def test_creates_an_audit_entry_and_notifies_the_employee():
    employee = _employee()
    absent_day = TODAY - timedelta(days=10)

    apply_penalisations_for(employee, today=TODAY, lookback_days=15)

    record = PenalisationRecord.objects.get(employee=employee, absent_date=absent_day)
    assert AuditLog.objects.filter(
        action="PenalisationRecord.applied", entity_id=str(record.pk)
    ).exists()
    assert Notification.objects.filter(user=employee.user, type="penalisation.applied").exists()


def test_apply_penalisations_covers_every_active_employee():
    active = _employee()
    exited = _employee()
    exited.status = "exited"
    exited.save(update_fields=["status"])

    apply_penalisations(today=TODAY)

    assert PenalisationRecord.objects.filter(employee=active).exists()
    assert not PenalisationRecord.objects.filter(employee=exited).exists()


def test_management_command_is_idempotent():
    _employee()

    call_command("apply_penalisations")
    first_count = PenalisationRecord.objects.count()
    call_command("apply_penalisations")
    second_count = PenalisationRecord.objects.count()

    assert first_count > 0
    assert second_count == first_count


def _leave_type(**overrides):
    from leave.models import LeaveType

    defaults = {"name": "Casual Leave", "annual_allocation": Decimal("12")}
    defaults.update(overrides)
    return LeaveType.objects.create(**defaults)


def test_deducts_leave_when_a_penalty_leave_type_is_configured():
    from leave.models import LeaveBalance

    employee = _employee()
    absent_day = TODAY - timedelta(days=3)  # lookback_days=3 -> exactly one qualifying day
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(pk=1, defaults={"penalty_leave_type": leave_type})

    apply_penalisations_for(employee, today=TODAY, lookback_days=3)

    record = PenalisationRecord.objects.get(employee=employee, absent_date=absent_day)
    assert record.leave_days_deducted == Decimal("1")  # no_attendance_leave_days_deducted default
    assert record.leave_balance is not None
    balance = LeaveBalance.objects.get(pk=record.leave_balance_id)
    assert balance.used == Decimal("1")
    assert balance.employee_id == employee.pk
    assert balance.leave_type_id == leave_type.pk


def test_does_not_deduct_when_no_attendance_rule_is_disabled():
    from leave.models import LeaveBalance

    employee = _employee()
    absent_day = TODAY - timedelta(days=3)
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1, defaults={"penalty_leave_type": leave_type, "no_attendance_enabled": False}
    )

    apply_penalisations_for(employee, today=TODAY, lookback_days=3)

    record = PenalisationRecord.objects.get(employee=employee, absent_date=absent_day)
    assert record.leave_days_deducted == Decimal("0")
    assert record.leave_balance is None
    assert not LeaveBalance.objects.filter(employee=employee).exists()


def test_deduction_amount_matches_the_configured_rate():
    employee = _employee()
    absent_day = TODAY - timedelta(days=3)
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "penalty_leave_type": leave_type,
            "no_attendance_leave_days_deducted": Decimal("2.5"),
        },
    )

    apply_penalisations_for(employee, today=TODAY, lookback_days=3)

    record = PenalisationRecord.objects.get(employee=employee, absent_date=absent_day)
    assert record.leave_days_deducted == Decimal("2.5")
    assert record.leave_balance.used == Decimal("2.5")
