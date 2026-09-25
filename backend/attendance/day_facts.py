"""Single source of truth for "what do we know about this calendar date" —
combines org_calendar's holidays/events/org-wide-WFH/week-off (already real)
and Leave's approved requests (PLAN.md Step 4) into one place, so request
validation (conflicts.py) and the day-view response (views.py) never compute
this independently and drift apart.

Facts here are independent overlays, not a collapsed single value — a date can
be a holiday *and* have an event *and* be an org WFH day all at once; nothing
here decides which one "wins". Conflict *rules* (which combinations are
allowed to coexist vs. rejected outright) live in conflicts.py, one layer up.

`is_weekend` is HR-admin-configurable (org_calendar.WeekOff), not a hardcoded
Saturday/Sunday assumption — deliberately corrected after the first version of
this module hardcoded it, per explicit instruction. The field name stays
`is_weekend` to match the frontend's existing AttendanceDayView contract; what
it actually means is "a configured week-off day."

`is_on_leave`/`leave_type_name` read Leave's own approved requests. This is the
one place attendance imports from leave — a narrow, read-only fact lookup, not
a shared model; Leave does not import anything from attendance in return (see
leave/conflicts.py's separate, one-directional check for the reverse rule).

`get_day_facts_range()` does the real work with a fixed number of queries for
the whole range; `get_day_facts()` (single date) is a thin wrapper over it.
Looping `get_day_facts()` per day for a multi-day view was an N+1 query
pattern found during manual verification (a 30-day history view was issuing
~100+ queries) — every multi-day caller must use the range function instead."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import timedelta

from org_calendar.models import CalendarEntry, CalendarEntryType, RecurringWfhRule, WeekOff


# WeekOff/RecurringWfhRule.weekday are Sunday-first (0=Sunday..6=Saturday,
# matching org_calendar's WEEKDAY_NAMES) — Python's date.weekday() is
# Monday-first (0=Monday..6=Sunday). This is the one conversion point.
def _sunday_first_weekday(the_date: date_cls) -> int:
    return (the_date.weekday() + 1) % 7


@dataclass
class DayFacts:
    date: date_cls
    is_weekend: bool
    holidays: list  # CalendarEntry rows, type=holiday — normally 0 or 1
    events: list  # CalendarEntry rows, type=event — any number
    is_org_wfh_day: bool
    org_wfh_note: str | None
    org_wfh_description: str | None
    is_on_leave: bool = False
    leave_type_name: str | None = None

    @property
    def is_holiday(self) -> bool:
        return bool(self.holidays)

    @property
    def holiday_name(self) -> str | None:
        return self.holidays[0].name if self.holidays else None

    @property
    def holiday_description(self) -> str | None:
        return self.holidays[0].description if self.holidays else None


def get_day_facts(the_date: date_cls, *, employee=None) -> DayFacts:
    """Single-date convenience wrapper. For anything spanning more than one
    date, call get_day_facts_range() directly instead — looping this one is
    the N+1 pattern this module exists to avoid."""
    return get_day_facts_range(the_date, the_date, employee=employee)[the_date]


def get_day_facts_range(start_date: date_cls, end_date: date_cls, *, employee=None) -> dict:
    """Every date from start_date to end_date inclusive, in a fixed number of
    queries regardless of the range's length: one for WeekOff, one for
    RecurringWfhRule, one for CalendarEntry across the whole range, and (only
    if `employee` is given) one for overlapping approved LeaveRequests."""
    week_off_weekdays = set(WeekOff.objects.filter(active=True).values_list("weekday", flat=True))
    recurring_by_weekday = {r.weekday: r for r in RecurringWfhRule.objects.filter(active=True)}

    entries_by_date = defaultdict(list)
    for entry in CalendarEntry.objects.filter(date__range=(start_date, end_date)):
        entries_by_date[entry.date].append(entry)

    leave_by_date = defaultdict(list)
    if employee is not None:
        # Deferred import: leave depends on nothing in attendance, but keeping
        # this local (rather than at module load time) avoids any Django
        # app-loading-order assumption between the two apps.
        from leave.models import LeaveRequest, LeaveRequestStatus

        overlapping = LeaveRequest.objects.filter(
            employee=employee,
            status=LeaveRequestStatus.APPROVED,
            start_date__lte=end_date,
            end_date__gte=start_date,
        ).select_related("leave_type")
        for leave_request in overlapping:
            day = max(leave_request.start_date, start_date)
            last = min(leave_request.end_date, end_date)
            while day <= last:
                leave_by_date[day].append(leave_request)
                day += timedelta(days=1)

    result = {}
    day = start_date
    while day <= end_date:
        entries = entries_by_date.get(day, [])
        holidays = [e for e in entries if e.type == CalendarEntryType.HOLIDAY]
        events = [e for e in entries if e.type == CalendarEntryType.EVENT]
        one_off_wfh = next((e for e in entries if e.type == CalendarEntryType.WFH), None)
        recurring = (
            recurring_by_weekday.get(_sunday_first_weekday(day)) if one_off_wfh is None else None
        )
        leaves = leave_by_date.get(day)
        leave = leaves[0] if leaves else None

        result[day] = DayFacts(
            date=day,
            is_weekend=_sunday_first_weekday(day) in week_off_weekdays,
            holidays=holidays,
            events=events,
            is_org_wfh_day=one_off_wfh is not None or recurring is not None,
            org_wfh_note=(
                one_off_wfh.name if one_off_wfh else (recurring.label if recurring else None)
            ),
            org_wfh_description=one_off_wfh.description if one_off_wfh else None,
            is_on_leave=leave is not None,
            leave_type_name=leave.leave_type.name if leave else None,
        )
        day += timedelta(days=1)

    return result
