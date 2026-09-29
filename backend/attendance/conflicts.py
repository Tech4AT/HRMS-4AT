"""Explicit conflict rules for WFH/Regularisation requests, applied at
request-creation time — before a request ever reaches the approvals engine.
Rejecting invalid combinations here (rather than silently no-op'ing them at
decision time) is a direct instruction from the project owner, given with one
worked example: a WFH request must be rejected outright if the date is
already a declared holiday.

Every rule below is a deliberate, documented decision — nothing here is an
inferred display precedence (that's day_facts.py's job: independent overlays,
none of which "win" over another). Two of these were genuine judgment calls
with no dictated answer; they're marked JUDGMENT CALL below rather than
presented as settled the way an earlier draft of this project's plan
mistakenly did.

Decided rules
-------------
1. Holiday blocks WFH and Regularisation — the given example, plus
   Regularisation by direct symmetry: neither request type makes sense for a
   day nobody was expected to work.
2. Weekend gets the same treatment as Holiday, for the same reason. (No
   shift-based custom working week exists yet — PLAN.md Step 6 — to say a
   given employee's "weekend" differs from Sat/Sun.)
3. An event never blocks anything — informational only, always returned
   independently (day_facts.DayFacts.events) regardless of what else is true
   that day.
4. A new WFH/Regularisation request cannot overlap a date already covered by
   the same employee's own submitted-or-approved WFH/Regularisation request —
   prevents duplicate/conflicting requests landing in the same approver's
   inbox for the same day.
5. Regularisation additionally requires the day to have no existing clock-in
   — "marks one whole day Present" (the frontend's own description) only
   makes sense for a day with nothing recorded yet. Rejecting this at
   creation, rather than the original handler's silent no-op at decision
   time, is what "validate before entering the approvals flow" means here.
6. JUDGMENT CALL — a multi-day WFH request failing on *any* day in its range
   rejects the *whole* request (naming the first offending date) rather than
   silently trimming itself to the valid days. Simpler, and treats the
   request as one approval unit rather than a partial one. Reversible if this
   isn't the wanted behaviour.
7. JUDGMENT CALL — an org-wide WFH day does NOT block a personal WFH request
   for the same date. The two aren't contradictory (both mean "not required
   to be in the office"), and there's no protective reason to forbid it.
8. **Leave blocks WFH and Regularisation** (PLAN.md Step 4, now built) — can't
   be on approved leave and requesting to work the same day. This is the
   one-directional counterpart to `leave/conflicts.py`'s own check that an
   active WFH/Regularisation request blocks a new Leave request; each app
   validates its own creation path against the other's data, neither imports
   the other's conflict rules.

Not applicable — Leave is allowed to span a holiday or week-off (an ordinary
multi-day leave request commonly does), unlike WFH/Regularisation, so nothing
here rejects that combination; see `leave/models.py` for how a leave day
lands (or doesn't) against week-off/holiday days for balance-deduction
purposes — that's Leave's decision to make, not this module's."""

from datetime import timedelta

from rest_framework.exceptions import ValidationError

from .day_facts import get_day_facts_range
from .models import AttendanceRecord, AttendanceRequest, AttendanceRequestStatus

_ACTIVE_STATUSES = [AttendanceRequestStatus.SUBMITTED, AttendanceRequestStatus.APPROVED]


def _date_range(start_date, end_date):
    day = start_date
    while day <= end_date:
        yield day
        day += timedelta(days=1)


def _reject_if_overlapping_own_request(employee, start_date, end_date):
    existing = (
        AttendanceRequest.objects.filter(
            employee=employee,
            status__in=_ACTIVE_STATUSES,
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


def validate_wfh_request(employee, start_date, end_date) -> None:
    facts_by_day = get_day_facts_range(start_date, end_date, employee=employee)
    for day in _date_range(start_date, end_date):
        facts = facts_by_day[day]
        if facts.is_holiday:
            raise ValidationError(f"{day} is a declared holiday — WFH cannot be requested for it.")
        if facts.is_weekend:
            raise ValidationError(f"{day} is a week-off day — WFH cannot be requested for it.")
        if facts.is_on_leave:
            raise ValidationError(f"{day} is already covered by an approved leave request.")
    _reject_if_overlapping_own_request(employee, start_date, end_date)


def validate_regularisation_request(employee, start_date, end_date) -> None:
    facts_by_day = get_day_facts_range(start_date, end_date, employee=employee)
    for day in _date_range(start_date, end_date):
        facts = facts_by_day[day]
        if facts.is_holiday:
            raise ValidationError(
                f"{day} is a declared holiday — regularisation cannot be requested for it."
            )
        if facts.is_weekend:
            raise ValidationError(
                f"{day} is a week-off day — regularisation cannot be requested for it."
            )
        if facts.is_on_leave:
            raise ValidationError(f"{day} is already covered by an approved leave request.")
        record = AttendanceRecord.objects.filter(employee=employee, attendance_date=day).first()
        if record is not None and record.clock_in_time:
            raise ValidationError(f"{day} already has a clock-in on record.")
    _reject_if_overlapping_own_request(employee, start_date, end_date)
