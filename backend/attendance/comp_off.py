"""PLAN.md Step 7 — Comp Off accrual. Resolves the two open decisions left
after Step 6 built `PolicySettings.comp_off_accrual_enabled`/
`comp_off_accrual_overtime_hours_per_comp_off` but nothing ever evaluated
them: evaluated at check-out (`views.py`), against a running per-employee
tally (`CompOffAccrualState`), not by a periodic scheduled sweep — overtime is
already computed right there (timing.py); and applied as a real
`LeaveBalance.allocated` credit against `PolicySettings.comp_off_leave_type`,
the same "one configurable leave type" shape `penalisation.py`'s
`_deduct_leave` already established for the opposite (penalty) direction."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from audit.service import write_audit
from leave.balances import get_or_seed_balance
from leave.models import LeaveBalance
from notifications.service import notify

from .models import CompOffAccrualState, PolicySettings


def accrue_comp_off(
    employee, overtime_minutes: int | None, policy: PolicySettings | None = None
) -> int:
    """Adds `overtime_minutes` to the employee's running uncredited tally and
    credits one Comp Off per full threshold crossed. Returns how many were
    credited (0 if the rule is disabled, no `comp_off_leave_type` is
    configured, there's no overtime to add, or the tally hasn't crossed the
    threshold yet — the minutes are still banked for next time either way,
    except when the rule itself is off or unconfigured, matching
    `_deduct_leave`'s "still record the fact, but consume nothing" framing)."""
    policy = policy or PolicySettings.load()
    if (
        not overtime_minutes
        or not policy.comp_off_accrual_enabled
        or policy.comp_off_leave_type_id is None
    ):
        return 0

    threshold_minutes = int(policy.comp_off_accrual_overtime_hours_per_comp_off * 60)
    if threshold_minutes <= 0:
        return 0

    # Locked (PLAN.md Step 12, same class of race as _deduct_leave): two
    # check-outs for the same employee can't overlap in practice (one active
    # AttendanceRecord per day), but the balance mutation below still needs
    # the same select_for_update() re-fetch discipline as every other
    # LeaveBalance write in this app.
    with transaction.atomic():
        state, _created = CompOffAccrualState.objects.get_or_create(employee=employee)
        state = CompOffAccrualState.objects.select_for_update().get(pk=state.pk)
        state.uncredited_overtime_minutes += overtime_minutes
        credited = state.uncredited_overtime_minutes // threshold_minutes
        if credited:
            state.uncredited_overtime_minutes -= credited * threshold_minutes
        state.save(update_fields=["uncredited_overtime_minutes", "updated_at"])

        if not credited:
            return 0

        financial_year = str(timezone.localdate().year)
        balance, _created = get_or_seed_balance(
            employee, policy.comp_off_leave_type, financial_year
        )
        balance = LeaveBalance.objects.select_for_update().get(pk=balance.pk)
        balance.allocated += Decimal(credited)
        balance.save(update_fields=["allocated", "updated_at"])
        write_audit(
            None,
            "LeaveBalance.comp_off_accrued",
            "LeaveBalance",
            balance.pk,
            {"comp_offs_credited": credited},
        )

    notify(
        employee.user,
        "comp_off.accrued",
        "You earned a Comp Off",
        f"{credited} Comp Off(s) credited for overtime worked.",
    )
    return credited
