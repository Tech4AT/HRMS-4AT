"""PLAN.md Step 7 — opening-balance seeding and carry-forward. The one place a
LeaveBalance row is ever created, so the self-service read
(`LeaveBalanceViewSet.list()`) and the scheduled year-rollover command
(`management/commands/roll_leave_balances.py`) never diverge on how a new
financial year's balance is seeded — whichever happens to run first for a
given employee/type/year does the real seeding; the other just finds the row
already there.

`financial_year` is a plain calendar-year string (Step 4) — "the previous
year" is simply `int(financial_year) - 1`, no fiscal-year offset.

Proration for a mid-year joiner is explicitly out of scope, same as Step 4
left it: a joiner's first balance row (no previous-year row exists yet) gets
the type's full `annual_allocation`, not a pro-rated fraction — undefined by
the frontend, not decided here."""

from decimal import Decimal

from django.db import transaction

from audit.service import write_audit

from .models import LeaveBalance


def get_or_seed_balance(
    employee, leave_type, financial_year: str, *, actor=None
) -> tuple[LeaveBalance, bool]:
    """Returns (balance, created) for this employee/type/year, seeding it on
    first reference. `allocated` is the type's current `annual_allocation`.
    `carry_forward` comes from the *previous* year's unused balance
    (`available`, floored at 0), capped at the type's `carry_forward_limit` —
    0 if no previous-year row exists (a brand new employee/type has nothing to
    carry forward). The portion of the previous year's balance that exceeded
    the cap is recorded as that row's own `lapsed` — computed once, here, and
    never revisited (matches `LeaveRequest.duration_days`'s own "computed once
    at creation, stored" precedent: a later policy change must not
    retroactively rewrite an already-closed year).

    `actor` is the user to credit in the audit trail — the caller's own user
    for the self-service read path, `None` (a system action, same convention
    as `provision_logins`) for the scheduled `roll_leave_balances` command.

    Locked (PLAN.md Step 12): two concurrent callers for the same
    employee/type/year (the self-service read racing the scheduled command,
    say) could otherwise both compute `carry_forward`/`lapsed` from the same
    unlocked `previous` row and both write it — a lost update, same class of
    bug as `views.py`'s balance mutations. `select_for_update()` on `previous`
    serializes them; the final `get_or_create()` is already race-safe on its
    own (the model's `UniqueConstraint` + Django's built-in retry-on-
    `IntegrityError`), which is also what keeps the no-previous-year case
    (nothing to lock yet) safe without needing a lock of its own."""
    with transaction.atomic():
        existing = (
            LeaveBalance.objects.select_for_update()
            .filter(employee=employee, leave_type=leave_type, financial_year=financial_year)
            .first()
        )
        if existing is not None:
            return existing, False

        previous_year = str(int(financial_year) - 1)
        previous = (
            LeaveBalance.objects.select_for_update()
            .filter(employee=employee, leave_type=leave_type, financial_year=previous_year)
            .first()
        )

        carry_forward = Decimal("0")
        if previous is not None:
            unused = max(previous.available, Decimal("0"))
            carry_forward = min(unused, leave_type.carry_forward_limit)
            lapsed = unused - carry_forward
            if previous.lapsed != lapsed:
                previous.lapsed = lapsed
                previous.save(update_fields=["lapsed", "updated_at"])
                write_audit(
                    actor,
                    "LeaveBalance.lapsed",
                    "LeaveBalance",
                    previous.pk,
                    {"financial_year": previous_year, "lapsed": str(lapsed)},
                )

        balance, created = LeaveBalance.objects.get_or_create(
            employee=employee,
            leave_type=leave_type,
            financial_year=financial_year,
            defaults={"allocated": leave_type.annual_allocation, "carry_forward": carry_forward},
        )
        if created:
            write_audit(
                actor,
                "LeaveBalance.seeded",
                "LeaveBalance",
                balance.pk,
                {
                    "financial_year": financial_year,
                    "allocated": str(balance.allocated),
                    "carry_forward": str(balance.carry_forward),
                },
            )
        return balance, created
