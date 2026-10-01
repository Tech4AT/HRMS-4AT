"""Unit coverage for the overlay/conflict model itself (day_facts.py,
conflicts.py) — independent of any view, since these are the layer the
project owner asked to be explicit and testable on their own."""

import pytest
from rest_framework.exceptions import ValidationError

from attendance import conflicts
from attendance.day_facts import get_day_facts
from attendance.models import AttendanceRecord, AttendanceRequest
from employees.factories import EmployeeFactory
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry, RecurringWfhRule

pytestmark = pytest.mark.django_db


# ------------------------------- day_facts -----------------------------------


def test_holiday_and_event_coexist_as_independent_facts():
    # 2026-01-26 is a Monday.
    employee = EmployeeFactory()
    calendar = make_calendar(employee)
    CalendarEntry.objects.create(
        calendar=calendar, type="holiday", date="2026-01-26", name="Republic Day"
    )
    CalendarEntry.objects.create(
        calendar=calendar, type="event", date="2026-01-26", name="Town Hall"
    )

    facts = get_day_facts_date("2026-01-26", employee)

    assert facts.is_holiday is True
    assert facts.holiday_name == "Republic Day"
    assert len(facts.events) == 1
    assert facts.events[0].name == "Town Hall"


def test_recurring_wfh_rule_uses_sunday_first_weekday():
    # Wednesday, in org_calendar's Sunday-first indexing, is weekday=3.
    employee = EmployeeFactory()
    RecurringWfhRule.objects.create(
        calendar=make_calendar(employee), weekday=3, label="Every Wednesday"
    )

    wednesday = get_day_facts_date("2026-01-28", employee)  # a Wednesday
    tuesday = get_day_facts_date("2026-01-27", employee)  # a Tuesday

    assert wednesday.is_org_wfh_day is True
    assert wednesday.org_wfh_note == "Every Wednesday"
    assert tuesday.is_org_wfh_day is False


def test_is_weekend_reflects_the_calendars_weekly_offs():
    employee = EmployeeFactory()
    make_calendar(employee)

    saturday = get_day_facts_date("2026-01-31", employee)
    monday = get_day_facts_date("2026-01-26", employee)

    assert saturday.is_weekend is True
    assert monday.is_weekend is False


def test_is_weekend_is_calendar_configurable_not_hardcoded():
    """Reconfiguring a calendar's weekly offs changes is_weekend, proving this
    isn't a hardcoded Sat/Sun check."""
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=((5, []),))  # Friday only

    friday = get_day_facts_date("2026-01-30", employee)
    saturday = get_day_facts_date("2026-01-31", employee)

    assert friday.is_weekend is True
    assert saturday.is_weekend is False


def test_an_employee_with_no_calendar_has_no_calendar_facts():
    employee = EmployeeFactory()
    other = EmployeeFactory()
    calendar = make_calendar(other)
    CalendarEntry.objects.create(calendar=calendar, type="holiday", date="2026-01-31", name="X")

    facts = get_day_facts_date("2026-01-31", employee)  # a Saturday and a holiday for `other`

    assert facts.is_weekend is False
    assert facts.is_holiday is False
    assert facts.events == []
    assert facts.is_org_wfh_day is False


def test_leave_is_left_out_when_include_leave_is_false():
    from datetime import date
    from decimal import Decimal

    from leave.models import LeaveRequest, LeaveRequestStatus, LeaveType

    employee = EmployeeFactory()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date="2026-04-01",
        end_date="2026-04-01",
        duration_days=Decimal("1"),
        financial_year="2026",
        status=LeaveRequestStatus.APPROVED,
    )

    with_leave = get_day_facts(date(2026, 4, 1), employee=employee)
    without_leave = get_day_facts(date(2026, 4, 1), employee=employee, include_leave=False)

    assert with_leave.is_on_leave is True
    assert with_leave.leave_type_name == "Casual Leave"
    assert without_leave.is_on_leave is False


def get_day_facts_date(iso: str, employee):
    from datetime import date

    return get_day_facts(date.fromisoformat(iso), employee=employee)


# ------------------------------- conflicts ------------------------------------


def _employee():
    employee = EmployeeFactory()
    make_calendar(employee)  # Saturday + Sunday off
    return employee


def _holiday(employee, iso):
    CalendarEntry.objects.create(
        calendar=employee.calendars.get(), type="holiday", date=iso, name="X"
    )


def test_wfh_blocked_on_a_holiday():
    employee = _employee()
    _holiday(employee, "2026-02-10")

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-02-10"), _d("2026-02-10"))


def test_wfh_blocked_on_a_weekend():
    employee = _employee()

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-01-31"), _d("2026-01-31"))  # Saturday


def test_wfh_allowed_on_a_calendar_wfh_day():
    employee = _employee()
    RecurringWfhRule.objects.create(
        calendar=employee.calendars.get(), weekday=3, label="Every Wednesday"
    )

    conflicts.validate_wfh_request(employee, _d("2026-01-28"), _d("2026-01-28"))  # no raise


def test_regularisation_blocked_on_a_holiday():
    employee = _employee()
    _holiday(employee, "2026-02-10")

    with pytest.raises(ValidationError):
        conflicts.validate_regularisation_request(employee, _d("2026-02-10"), _d("2026-02-10"))


def test_regularisation_blocked_if_already_clocked_in():
    employee = _employee()
    AttendanceRecord.objects.create(
        employee=employee, attendance_date=_d("2026-02-11"), clock_in_time="2026-02-11T09:00:00Z"
    )

    with pytest.raises(ValidationError):
        conflicts.validate_regularisation_request(employee, _d("2026-02-11"), _d("2026-02-11"))


def test_wfh_blocked_on_a_date_already_covered_by_approved_leave():
    from decimal import Decimal

    from leave.models import LeaveRequest, LeaveRequestStatus, LeaveType

    employee = _employee()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date="2026-04-01",
        end_date="2026-04-01",
        duration_days=Decimal("1"),
        financial_year="2026",
        status=LeaveRequestStatus.APPROVED,
    )

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-04-01"), _d("2026-04-01"))


def test_wfh_blocked_if_overlapping_own_pending_request():
    employee = _employee()
    AttendanceRequest.objects.create(
        employee=employee,
        request_type="wfh",
        start_date=_d("2026-03-01"),
        end_date=_d("2026-03-03"),
    )

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-03-02"), _d("2026-03-04"))


def test_wfh_not_blocked_by_a_cancelled_overlapping_request():
    employee = _employee()
    AttendanceRequest.objects.create(
        employee=employee,
        request_type="wfh",
        start_date=_d("2026-03-01"),
        end_date=_d("2026-03-03"),
        status="cancelled",
    )

    conflicts.validate_wfh_request(employee, _d("2026-03-02"), _d("2026-03-04"))  # no raise


def _d(iso: str):
    from datetime import date

    return date.fromisoformat(iso)
