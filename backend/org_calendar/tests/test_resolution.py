"""How several calendars combine for one employee (org_calendar/resolution.py).
Dates used: 2026-01 starts on a Thursday, so Saturdays are Jan 3/10/17/24/31 and
Sundays are Jan 4/11/18/25."""

from datetime import date

import pytest

from employees.factories import DepartmentFactory, EmployeeFactory
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry, RecurringWfhRule
from org_calendar.resolution import covering_calendar_ids, resolve_calendar_range

pytestmark = pytest.mark.django_db


def day(employee, iso):
    d = date.fromisoformat(iso)
    return resolve_calendar_range(employee, d, d)[d]


def add(calendar, type, iso, name, **extra):
    return CalendarEntry.objects.create(calendar=calendar, type=type, date=iso, name=name, **extra)


# ------------------------------ who a calendar covers -----------------------------------


def test_a_calendar_covers_listed_employees_and_listed_departments_only():
    department = DepartmentFactory()
    other_department = DepartmentFactory()
    direct = EmployeeFactory()
    member = EmployeeFactory(department=department)
    outsider = EmployeeFactory(department=other_department)
    calendar = make_calendar(direct, departments=[department])

    assert covering_calendar_ids(direct) == [calendar.pk]
    assert covering_calendar_ids(member) == [calendar.pk]
    assert covering_calendar_ids(outsider) == []


def test_a_department_is_matched_exactly_sub_departments_do_not_inherit():
    parent = DepartmentFactory()
    child = DepartmentFactory(parent=parent)
    make_calendar(departments=[parent])

    assert covering_calendar_ids(EmployeeFactory(department=child)) == []


def test_employee_covered_both_directly_and_by_department_gets_the_calendar_once():
    department = DepartmentFactory()
    employee = EmployeeFactory(department=department)
    calendar = make_calendar(employee, departments=[department])

    assert covering_calendar_ids(employee) == [calendar.pk]


def test_an_employee_without_a_department_is_covered_only_by_direct_assignment():
    employee = EmployeeFactory(department=None)
    make_calendar(departments=[DepartmentFactory()])

    assert covering_calendar_ids(employee) == []


# ------------------------------ no calendar, no facts -----------------------------------


def test_with_no_calendar_nothing_is_off_a_holiday_an_event_or_wfh():
    employee = EmployeeFactory()
    calendar = make_calendar(EmployeeFactory())  # someone else's, Sat/Sun off
    add(calendar, "holiday", "2026-01-31", "Elsewhere")
    RecurringWfhRule.objects.create(calendar=calendar, weekday=6)

    facts = day(employee, "2026-01-31")

    assert not facts.is_week_off and not facts.holidays and not facts.events and not facts.is_wfh


def test_there_is_no_fallback_a_new_calendar_does_not_leak_to_unassigned_people():
    employee = EmployeeFactory()
    make_calendar()  # assigned to nobody

    assert not day(employee, "2026-01-31").is_week_off


# ------------------------------ weekly offs ---------------------------------------------


def test_weekly_off_every_week():
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=((5, []),))  # Friday

    assert day(employee, "2026-01-02").is_week_off  # a Friday
    assert day(employee, "2026-01-30").is_week_off
    assert not day(employee, "2026-01-03").is_week_off


@pytest.mark.parametrize(
    "iso, off",
    [
        ("2026-01-03", False),  # 1st Saturday
        ("2026-01-10", True),  # 2nd
        ("2026-01-17", False),  # 3rd
        ("2026-01-24", True),  # 4th
        ("2026-01-31", False),  # 5th
    ],
)
def test_weekly_off_on_selected_weeks_of_the_month(iso, off):
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=((6, [2, 4]),))

    assert day(employee, iso).is_week_off is off


def test_weekly_offs_of_several_calendars_are_united():
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=((0, []),))  # Sundays
    make_calendar(employee, week_offs=((6, [2, 4]),))  # 2nd/4th Saturdays
    make_calendar(employee, week_offs=((5, []),))  # Fridays

    assert day(employee, "2026-01-04").is_week_off  # Sunday
    assert day(employee, "2026-01-10").is_week_off  # 2nd Saturday
    assert day(employee, "2026-01-02").is_week_off  # Friday
    assert not day(employee, "2026-01-03").is_week_off  # 1st Saturday: nobody's off
    assert not day(employee, "2026-01-05").is_week_off  # Monday


def test_a_partial_week_off_never_cancels_another_calendars_every_week_off():
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=((6, []),))
    make_calendar(employee, week_offs=((6, [2]),))

    assert day(employee, "2026-01-03").is_week_off  # 1st Saturday still off


def test_a_calendar_with_no_week_offs_makes_every_day_working():
    employee = EmployeeFactory()
    make_calendar(employee, week_offs=())

    assert not day(employee, "2026-01-03").is_week_off


# ------------------------------ holidays ------------------------------------------------


def test_holidays_from_different_calendars_are_all_included():
    employee = EmployeeFactory()
    first, second = make_calendar(employee), make_calendar(employee)
    add(first, "holiday", "2026-01-26", "Republic Day")
    add(second, "holiday", "2026-01-26", "Team Day")

    names = sorted(h.name for h in day(employee, "2026-01-26").holidays)

    assert names == ["Republic Day", "Team Day"]


def test_the_same_holiday_on_two_calendars_is_merged_by_name_ignoring_case():
    employee = EmployeeFactory()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    add(first, "holiday", "2026-01-26", "Republic Day")
    add(second, "holiday", "2026-01-26", "  republic day ")

    holidays = day(employee, "2026-01-26").holidays

    assert len(holidays) == 1


def test_if_any_copy_is_mandatory_the_merged_holiday_is_mandatory():
    employee = EmployeeFactory()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    add(first, "holiday", "2026-03-04", "Holi", optional=True)
    add(second, "holiday", "2026-03-04", "Holi", optional=False)

    facts = day(employee, "2026-03-04")

    assert [h.name for h in facts.holidays] == ["Holi"]
    assert facts.optional_holidays == []


def test_a_holiday_is_optional_only_when_every_copy_is_optional():
    employee = EmployeeFactory()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    add(first, "holiday", "2026-03-04", "Holi", optional=True)
    add(second, "holiday", "2026-03-04", "Holi", optional=True)

    facts = day(employee, "2026-03-04")

    assert facts.holidays == []
    assert [h.name for h in facts.optional_holidays] == ["Holi"]


def test_an_optional_holiday_does_not_close_the_day():
    from attendance.day_facts import get_day_facts

    employee = EmployeeFactory()
    add(make_calendar(employee), "holiday", "2026-03-04", "Holi", optional=True)

    facts = get_day_facts(date(2026, 3, 4), employee=employee)

    assert facts.is_holiday is False
    assert [h.name for h in facts.optional_holidays] == ["Holi"]


def test_a_holiday_is_special_if_any_copy_is_special():
    employee = EmployeeFactory()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    add(first, "holiday", "2026-01-26", "Republic Day", special=False)
    add(second, "holiday", "2026-01-26", "Republic Day", special=True)

    (holiday,) = day(employee, "2026-01-26").holidays

    assert holiday.special is True


# ------------------------------ events --------------------------------------------------


def test_events_are_united_and_deduplicated_by_name():
    employee = EmployeeFactory()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    add(first, "event", "2026-02-02", "Townhall")
    add(second, "event", "2026-02-02", "TOWNHALL")
    add(second, "event", "2026-02-02", "Offsite")

    names = sorted(e.name for e in day(employee, "2026-02-02").events)

    assert names == ["Offsite", "Townhall"]


def test_a_holiday_and_an_event_on_one_day_stay_independent():
    employee = EmployeeFactory()
    calendar = make_calendar(employee)
    add(calendar, "holiday", "2026-01-26", "Republic Day")
    add(calendar, "event", "2026-01-26", "Parade")

    facts = day(employee, "2026-01-26")

    assert len(facts.holidays) == 1 and len(facts.events) == 1


# ------------------------------ WFH -----------------------------------------------------


def test_wfh_from_any_calendar_counts():
    employee = EmployeeFactory()
    make_calendar(employee)
    other = make_calendar(employee)
    RecurringWfhRule.objects.create(calendar=other, weekday=3, label="Every Wednesday")

    wednesday = day(employee, "2026-01-28")
    tuesday = day(employee, "2026-01-27")

    assert wednesday.is_wfh and wednesday.wfh_note == "Every Wednesday"
    assert not tuesday.is_wfh


def test_an_inactive_recurring_wfh_rule_is_ignored():
    employee = EmployeeFactory()
    RecurringWfhRule.objects.create(
        calendar=make_calendar(employee), weekday=3, label="Off", active=False
    )

    assert not day(employee, "2026-01-28").is_wfh


def test_a_one_off_wfh_entry_beats_a_recurring_rule_for_the_note():
    employee = EmployeeFactory()
    calendar = make_calendar(employee, name="A")
    RecurringWfhRule.objects.create(calendar=calendar, weekday=3, label="Every Wednesday")
    add(make_calendar(employee, name="B"), "wfh", "2026-01-28", "Office closed", description="d")

    facts = day(employee, "2026-01-28")

    assert facts.is_wfh
    assert facts.wfh_note == "Office closed"
    assert facts.wfh_description == "d"


def test_between_recurring_rules_the_calendar_name_decides_the_note():
    employee = EmployeeFactory()
    RecurringWfhRule.objects.create(
        calendar=make_calendar(employee, name="Zeta"), weekday=3, label="From Zeta"
    )
    RecurringWfhRule.objects.create(
        calendar=make_calendar(employee, name="Alpha"), weekday=3, label="From Alpha"
    )

    assert day(employee, "2026-01-28").wfh_note == "From Alpha"


# ------------------------------ isolation and cost --------------------------------------


def test_only_the_employees_own_calendars_contribute():
    mine, theirs = EmployeeFactory(), EmployeeFactory()
    add(make_calendar(mine), "holiday", "2026-01-26", "Mine")
    add(make_calendar(theirs), "holiday", "2026-01-26", "Theirs")

    assert [h.name for h in day(mine, "2026-01-26").holidays] == ["Mine"]


def test_query_count_is_fixed_regardless_of_range_and_number_of_calendars(
    django_assert_max_num_queries,
):
    employee = EmployeeFactory()
    for i in range(4):
        calendar = make_calendar(employee, week_offs=((i, []),))
        add(calendar, "holiday", f"2026-01-{10 + i}", f"H{i}")
        RecurringWfhRule.objects.create(calendar=calendar, weekday=i)

    with django_assert_max_num_queries(5):
        result = resolve_calendar_range(employee, date(2026, 1, 1), date(2026, 12, 31))

    assert len(result) == 365
