"""What an employee's calendars say about each date - the one place several
calendars are combined into a single answer.

An employee is covered by a calendar if they are listed on it directly or their
department is listed on it (the exact department only; sub-departments do not
inherit). Calendars are independent peers: none is a default, and an employee
covered by none gets none of the facts below.

Combination rules for the calendars covering one employee (all additive):

* Weekly off  - a date is a week-off if ANY covering calendar marks it off
                (union). A calendar's "2nd and 4th Saturday" pattern is
                evaluated on its own; it never switches off another calendar's
                every-Saturday rule.
* Holidays    - holiday entries from all calendars are merged and de-duplicated
                by name (case-insensitive) per date. If any copy is mandatory
                the merged holiday is mandatory; it is optional only when every
                copy is optional. It is special if any copy is special. Only
                mandatory holidays close the day (`holidays`); optional ones
                are reported separately (`optional_holidays`).
* Events      - union, de-duplicated by name per date.
* WFH         - a date is a WFH day if ANY covering calendar has a one-off WFH
                entry on it or an active recurring rule for its weekday. For the
                displayed note a one-off entry beats a recurring rule, then
                calendars are taken in name order.

Ties between calendars are resolved by calendar name then id, so the result is
deterministic. A fixed number of queries serves any date range."""

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as date_cls
from datetime import timedelta

from django.db.models import Q

from org_calendar.models import (
    CalendarEntry,
    CalendarEntryType,
    RecurringWfhRule,
    WeekOff,
)


def sunday_first(the_date: date_cls) -> int:
    """Python's date.weekday() is Monday-first (0=Monday..6=Sunday); the stored
    weekdays are Sunday-first (0=Sunday..6=Saturday). The one conversion point."""
    return (the_date.weekday() + 1) % 7


def occurrence_in_month(the_date: date_cls) -> int:
    """1 for the first such weekday of the month ... 5 for the fifth."""
    return math.ceil(the_date.day / 7)


@dataclass(frozen=True)
class ResolvedEntry:
    name: str
    description: str | None
    optional: bool = False
    special: bool = False


@dataclass
class CalendarDay:
    is_week_off: bool = False
    holidays: list = field(default_factory=list)  # mandatory only
    optional_holidays: list = field(default_factory=list)
    events: list = field(default_factory=list)
    is_wfh: bool = False
    wfh_note: str | None = None
    wfh_description: str | None = None


def covering_calendar_ids(employee) -> list:
    """Ids of every calendar that applies to `employee`."""
    from org_calendar.models import Calendar

    condition = Q(employees=employee)
    if employee.department_id:
        condition |= Q(departments=employee.department_id)
    return list(Calendar.objects.filter(condition).distinct().values_list("pk", flat=True))


def _merge_holidays(rows) -> tuple[list, list]:
    groups = {}
    for entry in rows:
        groups.setdefault(entry.name.strip().casefold(), []).append(entry)
    mandatory, optional = [], []
    for group in groups.values():
        special = any(e.special for e in group)
        first_mandatory = next((e for e in group if not e.optional), None)
        chosen = first_mandatory or group[0]
        resolved = ResolvedEntry(chosen.name, chosen.description, chosen.optional, special)
        (optional if first_mandatory is None else mandatory).append(resolved)
    return mandatory, optional


def _merge_events(rows) -> list:
    seen = {}
    for entry in rows:
        seen.setdefault(entry.name.strip().casefold(), ResolvedEntry(entry.name, entry.description))
    return list(seen.values())


def resolve_calendar_range(employee, start_date: date_cls, end_date: date_cls) -> dict:
    """{date: CalendarDay} for every date from start_date to end_date inclusive."""
    calendar_ids = covering_calendar_ids(employee)

    week_offs_by_weekday = defaultdict(list)
    recurring_by_weekday = defaultdict(list)
    entries_by_date = defaultdict(list)
    if calendar_ids:
        for rule in WeekOff.objects.filter(calendar_id__in=calendar_ids):
            week_offs_by_weekday[rule.weekday].append(rule.weeks or [])
        for rule in RecurringWfhRule.objects.filter(
            calendar_id__in=calendar_ids, active=True
        ).order_by("calendar__name", "pk"):
            recurring_by_weekday[rule.weekday].append(rule)
        for entry in CalendarEntry.objects.filter(
            calendar_id__in=calendar_ids, date__range=(start_date, end_date)
        ).order_by("date", "calendar__name", "pk"):
            entries_by_date[entry.date].append(entry)

    result = {}
    day = start_date
    while day <= end_date:
        weekday = sunday_first(day)
        entries = entries_by_date.get(day, [])
        one_off_wfh = next((e for e in entries if e.type == CalendarEntryType.WFH), None)
        recurring = recurring_by_weekday.get(weekday, [])
        holidays, optional_holidays = _merge_holidays(
            [e for e in entries if e.type == CalendarEntryType.HOLIDAY]
        )

        facts = CalendarDay(
            is_week_off=any(
                not weeks or occurrence_in_month(day) in weeks
                for weeks in week_offs_by_weekday.get(weekday, [])
            ),
            holidays=holidays,
            optional_holidays=optional_holidays,
            events=_merge_events([e for e in entries if e.type == CalendarEntryType.EVENT]),
            is_wfh=one_off_wfh is not None or bool(recurring),
        )
        if one_off_wfh is not None:
            facts.wfh_note = one_off_wfh.name
            facts.wfh_description = one_off_wfh.description
        elif recurring:
            facts.wfh_note = recurring[0].label
        result[day] = facts
        day += timedelta(days=1)
    return result
