"""Comp Off, request-based. An employee asks to earn compensatory days for days
they worked that were off for them - a weekly off or a (mandatory) holiday on
one of their calendars. The request goes through the approvals engine like any
leave request. Whoever approves it chooses which leave type's balance receives
the credit, at the moment of approval (`_require_balance_choice`, a decision hook
registered with the approvals engine); one day per worked date is then added to
that balance (`credit_approved_request`, called from handlers.py). Replaces the
former automatic accrual from overtime hours.

Which dates may be claimed (`eligible_days`): off days for that employee, within
the last LOOKBACK_DAYS up to today, that are not on approved leave and not already
part of a submitted or approved Comp Off request. The employee declares what they
worked; each eligible day also reports whether a clock-in exists so the approver
and the form have that evidence in view, but a missing clock-in does not block
the request (approval is the check)."""

from datetime import date as date_cls
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from approvals.service import register_decision_hook
from attendance.day_facts import get_day_facts_range
from attendance.models import AttendanceRecord
from audit.service import write_audit
from notifications.service import notify

from .balances import get_or_seed_balance
from .models import CompOffRequest, LeaveBalance, LeaveRequestStatus, LeaveType, LeaveTypeStatus

LOOKBACK_DAYS = 90
MAX_DATES_PER_REQUEST = 31
_ACTIVE = (LeaveRequestStatus.SUBMITTED, LeaveRequestStatus.APPROVED)


def _claimed_dates(employee) -> set:
    claimed = set()
    for row in CompOffRequest.objects.filter(employee=employee, status__in=_ACTIVE):
        claimed.update(row.worked_dates)
    return claimed


def _off_reason(facts) -> str | None:
    reasons = []
    if facts.is_weekend:
        reasons.append("Weekly off")
    if facts.is_holiday:
        reasons.append(f"Holiday: {facts.holiday_name}")
    return " + ".join(reasons) or None


def eligible_days(employee, today: date_cls) -> list[dict]:
    """Off days this employee could still claim, newest first."""
    start = today - timedelta(days=LOOKBACK_DAYS)
    facts_by_day = get_day_facts_range(start, today, employee=employee)
    clocked_in = set(
        AttendanceRecord.objects.filter(
            employee=employee,
            attendance_date__range=(start, today),
            clock_in_time__isnull=False,
        ).values_list("attendance_date", flat=True)
    )
    claimed = _claimed_dates(employee)

    days = []
    for day, facts in sorted(facts_by_day.items(), reverse=True):
        reason = _off_reason(facts)
        if reason is None or facts.is_on_leave or day.isoformat() in claimed:
            continue
        days.append({"date": day.isoformat(), "reason": reason, "clocked_in": day in clocked_in})
    return days


def validate_comp_off_request(employee, dates: list[str], today: date_cls) -> list[date_cls]:
    """The parsed, sorted dates if every one is claimable; raises ValidationError
    otherwise."""
    if not isinstance(dates, list) or not dates:
        raise ValidationError({"worked_dates": "Select at least one day you worked."})
    if len(dates) > MAX_DATES_PER_REQUEST:
        raise ValidationError(
            {"worked_dates": f"A request can cover at most {MAX_DATES_PER_REQUEST} days."}
        )
    parsed = []
    for raw in dates:
        try:
            parsed.append(date_cls.fromisoformat(str(raw)))
        except ValueError as exc:
            raise ValidationError(
                {"worked_dates": f"'{raw}' is not a valid YYYY-MM-DD date."}
            ) from exc
    if len(set(parsed)) != len(parsed):
        raise ValidationError({"worked_dates": "Each day may be listed only once."})

    allowed = {d["date"] for d in eligible_days(employee, today)}
    for day in sorted(parsed):
        if day > today:
            raise ValidationError({"worked_dates": f"{day} is in the future."})
        if day.isoformat() not in allowed:
            raise ValidationError(
                {
                    "worked_dates": f"{day} can't be claimed: it is not an off day for you, is "
                    f"older than {LOOKBACK_DAYS} days, is covered by leave, or is already in "
                    "another Comp Off request."
                }
            )
    return sorted(parsed)


def credit_approved_request(row: CompOffRequest) -> None:
    """Adds the request's days to the balance of the leave type the approver chose.
    Called once, from the approvals receiver, when the request is approved. Locked
    like every other LeaveBalance write so it cannot race a concurrent leave
    request."""
    if row.leave_type_id is None:  # the decision hook makes this unreachable
        raise ValidationError("No leave balance was chosen for this Comp Off.")
    financial_year = str(row.decided_at.year if row.decided_at else date_cls.today().year)
    with transaction.atomic():
        balance, _created = get_or_seed_balance(row.employee, row.leave_type, financial_year)
        balance = LeaveBalance.objects.select_for_update().get(pk=balance.pk)
        balance.allocated += Decimal(row.days)
        balance.save(update_fields=["allocated", "updated_at"])
        write_audit(
            None,
            "LeaveBalance.comp_off_credited",
            "LeaveBalance",
            balance.pk,
            {"comp_off_request": row.pk, "days": str(row.days), "dates": row.worked_dates},
        )
    notify(
        row.employee.user,
        "comp_off.credited",
        "Comp Off credited",
        f"{row.days} day(s) added to your {row.leave_type.name} balance.",
    )


def _require_balance_choice(request, status: str, data: dict) -> None:
    """Approving a Comp Off needs the approver to say which balance to credit.
    Raises before the decision is persisted, so the request stays pending."""
    if status != "approved":
        return
    try:
        leave_type_id = int(data.get("leave_type_id"))
    except (TypeError, ValueError) as exc:
        raise ValidationError(
            {"leave_type_id": "Choose the leave balance to add this Comp Off to."}
        ) from exc
    leave_type = LeaveType.objects.filter(pk=leave_type_id, status=LeaveTypeStatus.ACTIVE).first()
    if leave_type is None:
        raise ValidationError({"leave_type_id": "Must reference an active leave type."})
    CompOffRequest.objects.filter(pk=(request.payload or {}).get("comp_off_request_id")).update(
        leave_type=leave_type
    )


register_decision_hook("comp_off", _require_balance_choice)
