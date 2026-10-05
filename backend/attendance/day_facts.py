"""Single source of truth for "what do we know about this calendar date" —
combines the employee's calendars (org_calendar: holidays/events/WFH/week-off,
merged by org_calendar/resolution.py) and Leave's approved requests (PLAN.md Step
4) into one place, so request validation (conflicts.py) and the day-view response
(views.py) never compute this independently and drift apart.

Facts here are independent overlays, not a collapsed single value — a date can
be a holiday *and* have an event *and* be an org WFH day all at once; nothing
here decides which one "wins". Conflict *rules* (which combinations are
allowed to coexist vs. rejected outright) live in conflicts.py, one layer up.

`is_weekend` comes from the employee's calendars' weekly offs (org_calendar.WeekOff),
never a hardcoded Saturday/Sunday. The field name stays `is_weekend` to match the
frontend's existing AttendanceDayView contract; what it actually means is "a
configured week-off day for this employee."

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
from dataclasses import dataclass, field
from datetime import date as date_cls
from datetime import timedelta

from org_calendar.resolution import resolve_calendar_range


@dataclass
class DayFacts:
    date: date_cls
    is_weekend: bool
    holidays: list  # mandatory holidays (org_calendar.resolution.ResolvedEntry) - 0 or more
    events: list  # org_calendar.resolution.ResolvedEntry - any number
    is_org_wfh_day: bool
    org_wfh_note: str | None
    org_wfh_description: str | None
    is_on_leave: bool = False
    leave_type_name: str | None = None
    # Optional holidays never close the day, so they are not part of `holidays`.
    optional_holidays: list = field(default_factory=list)

    @property
    def is_holiday(self) -> bool:
        return bool(self.holidays)

    @property
    def holiday_name(self) -> str | None:
        return self.holidays[0].name if self.holidays else None

    @property
    def holiday_description(self) -> str | None:
        return self.holidays[0].description if self.holidays else None

    @property
    def holiday_is_special(self) -> bool:
        return any(h.special for h in self.holidays)


def get_day_facts(the_date: date_cls, *, employee, include_leave: bool = True) -> DayFacts:
    """Single-date convenience wrapper. For anything spanning more than one
    date, call get_day_facts_range() directly instead — looping this one is
    the N+1 pattern this module exists to avoid."""
    return get_day_facts_range(the_date, the_date, employee=employee, include_leave=include_leave)[
        the_date
    ]


def get_day_facts_range(
    start_date: date_cls, end_date: date_cls, *, employee, include_leave: bool = True
) -> dict:
    """Every date from start_date to end_date inclusive, for `employee`, in a
    fixed number of queries regardless of the range's length: one to find the
    employee's calendars, three for their week-offs / recurring WFH / entries,
    and (only with include_leave) one for overlapping approved LeaveRequests.

    `employee` is required: calendar facts are per person, and an employee
    covered by no calendar has no week-offs, holidays, events or WFH days.
    `include_leave=False` returns calendar-derived facts only - for views that
    must not reveal anything about someone's leave."""
    calendar_days = resolve_calendar_range(employee, start_date, end_date)

    leave_by_date = defaultdict(list)
    if include_leave:
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
    for day, cal in calendar_days.items():
        leaves = leave_by_date.get(day)
        leave = leaves[0] if leaves else None
        result[day] = DayFacts(
            date=day,
            is_weekend=cal.is_week_off,
            holidays=cal.holidays,
            events=cal.events,
            is_org_wfh_day=cal.is_wfh,
            org_wfh_note=cal.wfh_note,
            org_wfh_description=cal.wfh_description,
            is_on_leave=leave is not None,
            leave_type_name=leave.leave_type.name if leave else None,
            optional_holidays=cal.optional_holidays,
        )
    return result
