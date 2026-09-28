"""PLAN.md Step 8 — Penalisation auto-apply. For each active employee, finds
any past date within the lookback window that:

- isn't a weekend/holiday/on-leave day (`day_facts.py`'s overlay facts,
  already the single source of truth for "was this employee expected to work
  that day" — not reinvented here). An org-wide WFH day does **not** exempt a
  day: Step 3 already treats WFH as informational only, not a change to the
  check-in expectation, so an employee is still expected to check in.
- has no real clock-in (no `AttendanceRecord` with `clock_in_time` set),
- has no regularisation request covering it that wasn't withdrawn — the
  frontend's own wording is "No regularisation request *submitted*", not
  "approved", so merely submitting one (even if later rejected) is what
  exempts the day, not the decision outcome. **Judgment call, flagged as
  one**: not directly confirmed, but the plain reading of that sentence.
- is at least `regularisation_grace_days` (`PolicySettings`) days in the past,
- doesn't already have a `PenalisationRecord` — the model's `UniqueConstraint`
  on `(employee, absent_date)` is the real idempotency guarantee; the
  in-memory check here just avoids a wasted `get_or_create` per already-
  penalised day on a re-run.

and creates exactly one `PenalisationRecord` for it, deducting real leave
from the employee's balance if `PolicySettings.no_attendance_enabled` and a
`penalty_leave_type` are both configured (resolves the "should a Penalisation
deduct a real LeaveBalance" open decision, post-Step-8) — see
`_deduct_leave()`."""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from audit.service import write_audit
from core.enums import EmployeeStatus
from employees.models import Employee
from leave.balances import get_or_seed_balance
from notifications.service import notify

from .day_facts import get_day_facts_range
from .models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceRequestType,
    PenalisationRecord,
    PolicySettings,
)

DEFAULT_LOOKBACK_DAYS = 90


def _deduct_leave(employee, policy: PolicySettings, today):
    """Returns `(leave_days_deducted, leave_balance)` — `(Decimal("0"), None)`
    if the No Attendance rule is disabled or no `penalty_leave_type` is
    configured, so a Penalisation still gets created (it's still a factual
    record of the unexplained absence) but consumes nothing. Deducts against
    the *current* financial year (a plain calendar year, same as everywhere
    else in `leave` — Step 4) — not the year the absence itself fell in,
    matching the "penalise now, for today's balance" framing of a corrective
    action rather than a retroactive balance rewrite."""
    if not policy.no_attendance_enabled or policy.penalty_leave_type_id is None:
        return Decimal("0"), None

    financial_year = str(today.year)
    balance, _created = get_or_seed_balance(employee, policy.penalty_leave_type, financial_year)
    days = policy.no_attendance_leave_days_deducted
    balance.used = balance.used + days
    balance.save(update_fields=["used", "updated_at"])
    write_audit(
        None,
        "LeaveBalance.penalised",
        "LeaveBalance",
        balance.pk,
        {"leave_days_deducted": str(days)},
    )
    return days, balance


def _regularised_days(employee, start, end) -> set:
    days = set()
    requests = AttendanceRequest.objects.filter(
        employee=employee,
        request_type=AttendanceRequestType.REGULARISATION,
        start_date__lte=end,
        end_date__gte=start,
    ).exclude(status=AttendanceRequestStatus.CANCELLED)
    for req in requests:
        day = max(req.start_date, start)
        last = min(req.end_date, end)
        while day <= last:
            days.add(day)
            day += timedelta(days=1)
    return days


def apply_penalisations_for(employee, *, today=None, lookback_days=DEFAULT_LOOKBACK_DAYS) -> int:
    """Returns how many new `PenalisationRecord`s were created for this
    employee. `today`/`lookback_days` are parameters (not hardcoded) so tests
    can pin a deterministic window instead of depending on the real clock."""
    today = today or timezone.localdate()
    policy = PolicySettings.load()
    grace_days = policy.regularisation_grace_days

    start = today - timedelta(days=lookback_days)
    end = today - timedelta(days=grace_days)
    if start > end:
        return 0

    facts_by_day = get_day_facts_range(start, end, employee=employee)
    clocked_in_days = set(
        AttendanceRecord.objects.filter(
            employee=employee,
            attendance_date__range=(start, end),
            clock_in_time__isnull=False,
        ).values_list("attendance_date", flat=True)
    )
    regularised_days = _regularised_days(employee, start, end)
    already_penalised = set(
        PenalisationRecord.objects.filter(
            employee=employee, absent_date__range=(start, end)
        ).values_list("absent_date", flat=True)
    )

    created = 0
    day = start
    while day <= end:
        facts = facts_by_day[day]
        if (
            not facts.is_weekend
            and not facts.is_holiday
            and not facts.is_on_leave
            and day not in clocked_in_days
            and day not in regularised_days
            and day not in already_penalised
        ):
            deadline = day + timedelta(days=grace_days)
            reason = (
                f"No regularisation request submitted within {grace_days} "
                "day(s) of the unexplained absence."
            )
            record, was_created = PenalisationRecord.objects.get_or_create(
                employee=employee,
                absent_date=day,
                defaults={
                    "regularisation_deadline": deadline,
                    "days_overdue": max(0, (today - deadline).days),
                    "reason": reason,
                },
            )
            if was_created:
                leave_days_deducted, leave_balance = _deduct_leave(employee, policy, today)
                record.leave_days_deducted = leave_days_deducted
                record.leave_balance = leave_balance
                record.save(update_fields=["leave_days_deducted", "leave_balance"])

                write_audit(None, "PenalisationRecord.applied", "PenalisationRecord", record.pk)
                body = f"{day.isoformat()} — {reason}"
                if leave_days_deducted:
                    body += f" {leave_days_deducted} day(s) of leave were deducted."
                notify(
                    employee.user,
                    "penalisation.applied",
                    "You have been penalised for an unexplained absence",
                    body,
                )
            created += int(was_created)
        day += timedelta(days=1)
    return created


def apply_penalisations(*, today=None, lookback_days=DEFAULT_LOOKBACK_DAYS) -> int:
    """Runs `apply_penalisations_for` across every active employee — the
    entry point the `apply_penalisations` management command calls."""
    total = 0
    for employee in Employee.objects.filter(status=EmployeeStatus.ACTIVE):
        total += apply_penalisations_for(employee, today=today, lookback_days=lookback_days)
    return total
