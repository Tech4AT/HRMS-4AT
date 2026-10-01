"""Leave day-counting — how many days a request actually draws from a balance.

A full-day request's duration excludes any day that's a configured week-off
or a declared (mandatory) holiday on one of that employee's calendars
(attendance.day_facts's own overlays): the same "you
weren't going to work that day anyway" reasoning the frontend's own estimate
already applies to weekends (leave/page.tsx's estimateDays). Week-offs being
excluded is directly confirmed (they must be HR-configurable, not assumed —
see org_calendar.WeekOff, per calendar). **Excluding holidays the same way is this app's own
consistent extension of that reasoning, not separately confirmed the same
way** — flagged here specifically, since it's the one part of this
calculation that wasn't a direct instruction. Revisit here if a holiday inside
a leave request should instead still consume a leave day.

A half-day request is always exactly 0.5 days, for a single date only —
matches the frontend's own estimateDays (`dayType !== 'full_day'` returns 0.5
flatly) and leave/page.tsx's handleSubmit, which forces `end_date == start_date`
whenever a half-day option is chosen."""

from decimal import Decimal

from attendance.day_facts import get_day_facts_range

from .models import HalfDayOption

HALF_DAY = Decimal("0.5")


def compute_duration_days(employee, start_date, end_date, half_day_option: str) -> Decimal:
    if half_day_option != HalfDayOption.FULL_DAY:
        return HALF_DAY

    # Week-offs and holidays come from the employee's own calendars; leave
    # overlap is not needed to count days, so skip that query.
    facts_by_day = get_day_facts_range(start_date, end_date, employee=employee, include_leave=False)
    return Decimal(
        sum(1 for facts in facts_by_day.values() if not facts.is_weekend and not facts.is_holiday)
    )
