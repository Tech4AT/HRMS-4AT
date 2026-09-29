from decimal import Decimal

import pytest
from rest_framework.exceptions import ValidationError

from attendance.models import AttendanceRequest
from employees.factories import EmployeeFactory
from leave import conflicts
from leave.duration import compute_duration_days
from leave.models import HalfDayOption, LeaveBalance, LeaveRequest, LeaveType
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db


def _employee():
    return EmployeeFactory()


def _leave_type(**kwargs):
    return LeaveType.objects.create(name=kwargs.pop("name", "Casual Leave"), **kwargs)


def _d(iso):
    from datetime import date

    return date.fromisoformat(iso)


# ------------------------------- duration --------------------------------


def test_full_day_duration_excludes_week_off_and_holiday():
    # 2026-02-02..2026-02-08 is Mon..Sun. Default week-off is Sat/Sun.
    CalendarEntry.objects.create(type="holiday", date="2026-02-04", name="X")  # Wednesday
    employee = _employee()

    duration = compute_duration_days(employee, _d("2026-02-02"), _d("2026-02-08"), "full_day")

    assert duration == Decimal("4")  # 7 days - 1 holiday - 2 weekend days


def test_half_day_is_always_half_regardless_of_range():
    employee = _employee()

    duration = compute_duration_days(
        employee, _d("2026-02-02"), _d("2026-02-02"), HalfDayOption.FIRST_HALF
    )

    assert duration == Decimal("0.5")


# ------------------------------- conflicts --------------------------------


def test_leave_allowed_to_span_a_holiday():
    CalendarEntry.objects.create(type="holiday", date="2026-02-04", name="X")
    employee = _employee()
    leave_type = _leave_type()

    duration = conflicts.validate_leave_request(
        employee, leave_type, _d("2026-02-02"), _d("2026-02-06"), "full_day"
    )

    assert duration > 0  # no raise, and the holiday didn't count


def test_rejects_a_range_with_zero_working_days():
    employee = _employee()
    leave_type = _leave_type()

    with pytest.raises(ValidationError):
        conflicts.validate_leave_request(
            employee, leave_type, _d("2026-01-31"), _d("2026-02-01"), "full_day"  # Sat, Sun
        )


def test_rejects_a_cross_calendar_year_range():
    employee = _employee()
    leave_type = _leave_type()

    with pytest.raises(ValidationError):
        conflicts.validate_leave_request(
            employee, leave_type, _d("2026-12-30"), _d("2027-01-02"), "full_day"
        )


def test_rejects_half_day_spanning_two_dates():
    employee = _employee()
    leave_type = _leave_type()

    with pytest.raises(ValidationError):
        conflicts.validate_leave_request(
            employee, leave_type, _d("2026-02-02"), _d("2026-02-03"), HalfDayOption.FIRST_HALF
        )


def test_rejects_overlapping_own_leave_request_of_a_different_type():
    employee = _employee()
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=_leave_type(name="Sick Leave"),
        start_date=_d("2026-03-02"),
        end_date=_d("2026-03-04"),
        duration_days=Decimal("3"),
        financial_year="2026",
    )

    with pytest.raises(ValidationError):
        conflicts.validate_leave_request(
            employee,
            _leave_type(name="Casual Leave"),
            _d("2026-03-03"),
            _d("2026-03-05"),
            "full_day",
        )


def test_rejects_overlapping_an_active_wfh_request():
    employee = _employee()
    AttendanceRequest.objects.create(
        employee=employee,
        request_type="wfh",
        start_date=_d("2026-03-02"),
        end_date=_d("2026-03-04"),
    )

    with pytest.raises(ValidationError):
        conflicts.validate_leave_request(
            employee, _leave_type(), _d("2026-03-03"), _d("2026-03-05"), "full_day"
        )


def test_insufficient_balance_is_rejected():
    leave_type = _leave_type(annual_allocation=Decimal("2"))
    employee = _employee()
    balance = LeaveBalance.objects.create(
        employee=employee, leave_type=leave_type, financial_year="2026", allocated=Decimal("2")
    )

    with pytest.raises(ValidationError):
        conflicts.validate_sufficient_balance(balance, Decimal("5"))
