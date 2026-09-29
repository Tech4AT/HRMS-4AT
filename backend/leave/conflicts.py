"""Explicit conflict rules for Leave requests, applied at request-creation
time — mirrors attendance/conflicts.py's shape and reasoning exactly.

Decided rules
-------------
1. A new Leave request cannot overlap the same employee's own existing
   submitted-or-approved Leave request, regardless of leave type — can't be on
   two kinds of leave at once, symmetric to attendance/conflicts.py's own-type
   overlap rule.
2. A new Leave request cannot overlap the same employee's own existing
   submitted-or-approved WFH/Regularisation request — the direct instruction's
   "Leave vs WFH/Regularisation" interaction, from this side. The reverse
   direction (a new WFH/Regularisation request rejected if it overlaps an
   *approved* Leave) lives in attendance/conflicts.py, rule 8 — each app
   validates its own creation path against the other's data; neither imports
   the other's conflict *rules*, only the narrow fact it needs.
3. Leave is explicitly **not** rejected for spanning a holiday or a
   configured week-off — the direct instruction ("leave should be allowed to
   span holidays"). Those days simply don't count toward `duration_days`
   (leave/duration.py) — nothing here needs to reject anything for them.
4. A full-day request must span at least one day that isn't a week-off or
   holiday (`duration_days > 0`) — a request that would draw zero days from
   the balance doesn't mean anything.
5. A half-day request must be for a single date (`start_date == end_date`) —
   matches leave/page.tsx's own forced behaviour (a half-day pick always
   collapses `end_date` to `start_date` before submitting).
6. Sufficient balance is required at creation — `duration_days` cannot exceed
   `LeaveBalance.available` for the resolved financial year.

JUDGMENT CALL, flagged as one
------------------------------
7. A request may not cross a calendar-year boundary (`start_date.year ==
   end_date.year`) — `financial_year` is a plain calendar year (matches the
   retired mock's exact format, leave/models.py), so a request spanning two
   years would need to draw from two balance rows. Rejecting this outright is
   an MVP simplification, not a dictated rule; splitting the deduction across
   two balances is the alternative if this isn't the wanted behaviour."""

from rest_framework.exceptions import ValidationError

from .duration import compute_duration_days
from .models import HalfDayOption, LeaveRequest, LeaveRequestStatus

_ACTIVE_STATUSES = [LeaveRequestStatus.SUBMITTED, LeaveRequestStatus.APPROVED]


def _reject_if_overlapping_own_leave(employee, start_date, end_date):
    existing = (
        LeaveRequest.objects.filter(
            employee=employee,
            status__in=_ACTIVE_STATUSES,
            start_date__lte=end_date,
            end_date__gte=start_date,
        )
        .select_related("leave_type")
        .order_by("start_date")
        .first()
    )
    if existing is not None:
        raise ValidationError(
            f"You already have a {existing.leave_type.name} request "
            f"({existing.start_date} to {existing.end_date}) covering this date range."
        )


def _reject_if_overlapping_attendance_request(employee, start_date, end_date):
    # Deferred import: leave depends on attendance for this one narrow check;
    # attendance does not import anything from leave in return (day_facts.py's
    # own deferred import is the one place attendance reads from leave).
    from attendance.models import AttendanceRequest, AttendanceRequestStatus

    existing = (
        AttendanceRequest.objects.filter(
            employee=employee,
            status__in=[AttendanceRequestStatus.SUBMITTED, AttendanceRequestStatus.APPROVED],
            start_date__lte=end_date,
            end_date__gte=start_date,
        )
        .order_by("start_date")
        .first()
    )
    if existing is not None:
        raise ValidationError(
            f"You already have a {existing.get_request_type_display().lower()} request "
            f"({existing.start_date} to {existing.end_date}) covering this date range."
        )


def validate_leave_request(employee, leave_type, start_date, end_date, half_day_option: str):
    if end_date < start_date:
        raise ValidationError({"end_date": "Must not be before start_date."})
    if half_day_option != HalfDayOption.FULL_DAY and start_date != end_date:
        raise ValidationError("A half-day request must be for a single date.")
    if start_date.year != end_date.year:
        raise ValidationError(
            "A leave request cannot span more than one calendar year — "
            "submit it as two separate requests either side of the boundary."
        )

    duration_days = compute_duration_days(employee, start_date, end_date, half_day_option)
    if duration_days <= 0:
        raise ValidationError(
            "This date range has no working days to request leave for "
            "(every day in it is a week-off or holiday)."
        )

    _reject_if_overlapping_own_leave(employee, start_date, end_date)
    _reject_if_overlapping_attendance_request(employee, start_date, end_date)

    return duration_days


def validate_sufficient_balance(balance, duration_days) -> None:
    if duration_days > balance.available:
        raise ValidationError(
            f"Insufficient balance: {duration_days} day(s) requested, "
            f"{balance.available} available."
        )
