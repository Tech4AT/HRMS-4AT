from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest

from attendance.models import Shift
from attendance.timing import checkout_timing_for, late_minutes_for
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

ORG_TZ = ZoneInfo("Asia/Kolkata")


def _shift(start, end, break_minutes=0):
    return Shift.objects.create(
        name=f"Shift {start}-{end}", start_time=start, end_time=end, break_minutes=break_minutes
    )


def _local(y, m, d, h, mi):
    """A timestamp at this org-local wall-clock time — same shape as what's
    actually stored (UTC-aware), but built directly in ORG_TIMEZONE since
    astimezone() normalizes regardless of the input's original tzinfo."""
    return datetime(y, m, d, h, mi, tzinfo=ORG_TZ)


def test_late_minutes_for_employee_with_no_shift_is_none():
    employee = EmployeeFactory()

    assert late_minutes_for(employee, _local(2026, 9, 28, 10, 45)) is None


def test_late_minutes_for_late_check_in():
    employee = EmployeeFactory()
    _shift(time(9, 30), time(18, 30)).employees.add(employee)

    assert late_minutes_for(employee, _local(2026, 9, 28, 10, 45)) == 75


def test_late_minutes_for_on_time_check_in():
    employee = EmployeeFactory()
    _shift(time(9, 30), time(18, 30)).employees.add(employee)

    assert late_minutes_for(employee, _local(2026, 9, 28, 9, 15)) == 0


def test_checkout_timing_for_employee_with_no_shift_is_none():
    employee = EmployeeFactory()

    assert checkout_timing_for(employee, _local(2026, 9, 28, 18, 0), 480) == (None, None)


def test_checkout_timing_for_early_departure():
    employee = EmployeeFactory()
    _shift(time(9, 30), time(18, 30)).employees.add(employee)

    early, overtime = checkout_timing_for(employee, _local(2026, 9, 28, 10, 51), 6)

    assert early == 459  # 18:30 - 10:51
    assert overtime == 0


def test_checkout_timing_for_overtime():
    employee = EmployeeFactory()
    _shift(time(9, 30), time(18, 30), break_minutes=30).employees.add(employee)
    # scheduled = 9h - 30m break = 510 minutes; worked 600 -> 90 overtime, not early
    early, overtime = checkout_timing_for(employee, _local(2026, 9, 28, 20, 0), 600)

    assert early == 0
    assert overtime == 90


def test_checkout_timing_for_overnight_shift():
    employee = EmployeeFactory()
    _shift(time(22, 0), time(6, 0)).employees.add(employee)
    # scheduled = 8h = 480 minutes; checked out exactly on time, no overtime/early
    early, overtime = checkout_timing_for(employee, _local(2026, 9, 29, 6, 0), 480)

    assert early == 0
    assert overtime == 0


def test_employee_assigned_to_multiple_shifts_uses_the_lowest_pk_one():
    employee = EmployeeFactory()
    _shift(time(14, 0), time(23, 0)).employees.add(employee)  # created first, lower pk
    _shift(time(9, 30), time(18, 30)).employees.add(employee)

    assert (
        late_minutes_for(employee, _local(2026, 9, 28, 10, 45)) == 0
    )  # on time for the 14:00 shift
