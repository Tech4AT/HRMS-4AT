"""Unit coverage for the overlay/conflict model itself (day_facts.py,
conflicts.py) — independent of any view, since these are the layer the
project owner asked to be explicit and testable on their own."""

import pytest
from rest_framework.exceptions import ValidationError

from attendance import conflicts
from attendance.day_facts import get_day_facts
from attendance.models import AttendanceRecord, AttendanceRequest
from employees.factories import EmployeeFactory
from org_calendar.models import CalendarEntry, RecurringWfhRule

pytestmark = pytest.mark.django_db


# ------------------------------- day_facts -----------------------------------


def test_holiday_and_event_coexist_as_independent_facts():
    # 2026-01-26 is a Monday.
    CalendarEntry.objects.create(type="holiday", date="2026-01-26", name="Republic Day")
    CalendarEntry.objects.create(type="event", date="2026-01-26", name="Town Hall")

    facts = get_day_facts_date("2026-01-26")

    assert facts.is_holiday is True
    assert facts.holiday_name == "Republic Day"
    assert len(facts.events) == 1
    assert facts.events[0].name == "Town Hall"


def test_recurring_wfh_rule_uses_sunday_first_weekday():
    # Wednesday, in org_calendar's Sunday-first indexing, is weekday=3.
    RecurringWfhRule.objects.create(weekday=3, label="Every Wednesday")

    wednesday = get_day_facts_date("2026-01-28")  # a Wednesday
    tuesday = get_day_facts_date("2026-01-27")  # a Tuesday

    assert wednesday.is_org_wfh_day is True
    assert wednesday.org_wfh_note == "Every Wednesday"
    assert tuesday.is_org_wfh_day is False


def test_is_weekend_reflects_the_default_seeded_week_off():
    saturday = get_day_facts_date("2026-01-31")
    monday = get_day_facts_date("2026-01-26")

    assert saturday.is_weekend is True
    assert monday.is_weekend is False


def test_is_weekend_is_hr_configurable_not_hardcoded():
    """The whole point of WeekOff (org_calendar) existing: reconfiguring it
    changes is_weekend, proving this isn't a hardcoded Sat/Sun check."""
    from org_calendar.models import WeekOff

    WeekOff.objects.filter(weekday=6).update(active=False)  # Saturday no longer off
    WeekOff.objects.create(weekday=5, active=True)  # Friday now off instead

    friday = get_day_facts_date("2026-01-30")
    saturday = get_day_facts_date("2026-01-31")

    assert friday.is_weekend is True
    assert saturday.is_weekend is False


def test_is_on_leave_only_populates_when_an_employee_is_given():
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

    with_employee = get_day_facts(date(2026, 4, 1), employee=employee)
    without_employee = get_day_facts(date(2026, 4, 1))

    assert with_employee.is_on_leave is True
    assert with_employee.leave_type_name == "Casual Leave"
    assert without_employee.is_on_leave is False


def get_day_facts_date(iso: str):
    from datetime import date

    return get_day_facts(date.fromisoformat(iso))


# ------------------------------- conflicts ------------------------------------


def _employee():
    return EmployeeFactory()


def test_wfh_blocked_on_a_holiday():
    CalendarEntry.objects.create(type="holiday", date="2026-02-10", name="X")
    employee = _employee()

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-02-10"), _d("2026-02-10"))


def test_wfh_blocked_on_a_weekend():
    employee = _employee()

    with pytest.raises(ValidationError):
        conflicts.validate_wfh_request(employee, _d("2026-01-31"), _d("2026-01-31"))  # Saturday


def test_wfh_allowed_on_an_org_wide_wfh_day():
    RecurringWfhRule.objects.create(weekday=3, label="Every Wednesday")
    employee = _employee()

    conflicts.validate_wfh_request(employee, _d("2026-01-28"), _d("2026-01-28"))  # no raise


def test_regularisation_blocked_on_a_holiday():
    CalendarEntry.objects.create(type="holiday", date="2026-02-10", name="X")
    employee = _employee()

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
