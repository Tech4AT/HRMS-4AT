"""Test helpers for calendars."""

import itertools

from org_calendar.models import Calendar, WeekOff

_counter = itertools.count(1)

SAT_SUN = ((6, []), (0, []))  # (weekday, weeks) - Sunday-first, empty weeks = every week


def make_calendar(*employees, name=None, week_offs=SAT_SUN, departments=()) -> Calendar:
    """A calendar that covers `employees` (and `departments`), with the given
    weekly offs. Defaults to Saturday + Sunday off, every week."""
    calendar = Calendar.objects.create(name=name or f"Test calendar {next(_counter)}")
    calendar.employees.set(employees)
    calendar.departments.set(departments)
    for weekday, weeks in week_offs:
        WeekOff.objects.create(calendar=calendar, weekday=weekday, weeks=list(weeks))
    return calendar
