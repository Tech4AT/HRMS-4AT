"""Computes an AttendanceRecord's late-arrival/early-leave/overtime minutes
against the employee's assigned Shift (PLAN.md Step 6 — the Shift model was
built but never wired into check-in/check-out, so these three fields stayed
None forever; found during manual verification, not the original Step 6 scope).

Shift start/end times are wall-clock times in settings.ORG_TIMEZONE, not
Django's UTC `TIME_ZONE` — clock_in_time/clock_out_time (stored in UTC) are
converted to ORG_TIMEZONE here before comparing, matching how the frontend
displays them to the viewer. Using `timezone.localtime()` instead would be a
no-op (TIME_ZONE is UTC) and silently compare against the wrong wall clock.

An employee with no assigned Shift has no schedule to compare against, so all
three stay None for them — same as before any Shift existed. An employee
assigned to more than one Shift (the assignment UI doesn't prevent it) uses
the lowest-pk one, deterministically. `shift_for`/`scheduled_minutes_for` are
also used by day_view.py to show the shift's own start/end/scheduled-hours on
the frontend's attendance visual, not just to compute these three fields."""

from zoneinfo import ZoneInfo

from django.conf import settings

from .models import Shift


def _org_local(dt):
    return dt.astimezone(ZoneInfo(settings.ORG_TIMEZONE))


def shift_for(employee):
    return Shift.objects.filter(employees=employee).order_by("pk").first()


def _minutes_of_day(t) -> int:
    return t.hour * 60 + t.minute


def scheduled_minutes_for(shift) -> int:
    """A shift's scheduled working minutes (span minus break) — the "full bar"
    an effective-hours progress visual fills up against. Handles an overnight
    shift (e.g. 22:00-06:00) the same way checkout_timing_for does."""
    span = _minutes_of_day(shift.end_time) - _minutes_of_day(shift.start_time)
    if span <= 0:
        span += 24 * 60
    return max(0, span - shift.break_minutes)


def late_minutes_for(employee, clock_in_time) -> int | None:
    """`clock_in_time` is the UTC-aware datetime as stored on the record."""
    shift = shift_for(employee)
    if shift is None:
        return None
    local_in = _org_local(clock_in_time)
    scheduled_start = local_in.replace(
        hour=shift.start_time.hour, minute=shift.start_time.minute, second=0, microsecond=0
    )
    return max(0, int((local_in - scheduled_start).total_seconds() // 60))


def checkout_timing_for(employee, clock_out_time, working_minutes):
    """Returns (early_leave_minutes, overtime_minutes) — both None if the
    employee has no assigned shift. `clock_out_time` is UTC-aware, as stored."""
    shift = shift_for(employee)
    if shift is None:
        return None, None

    local_out = _org_local(clock_out_time)
    scheduled_end = local_out.replace(
        hour=shift.end_time.hour, minute=shift.end_time.minute, second=0, microsecond=0
    )
    early_leave_minutes = max(0, int((scheduled_end - local_out).total_seconds() // 60))
    overtime_minutes = max(0, working_minutes - scheduled_minutes_for(shift))

    return early_leave_minutes, overtime_minutes
