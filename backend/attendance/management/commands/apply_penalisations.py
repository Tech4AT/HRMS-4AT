"""PLAN.md Step 8 — the scheduled job that auto-applies Penalisations, using
the same shared mechanism Step 7's `roll_leave_balances` established: a plain
management command invoked by an external scheduler (OS cron / Windows Task
Scheduler), not a task queue (none exists anywhere in this repo). Idempotent
by construction — `PenalisationRecord`'s `UniqueConstraint` on
`(employee, absent_date)` means running this twice (or daily) never
double-applies the same absence."""

from django.core.management.base import BaseCommand

from attendance.penalisation import DEFAULT_LOOKBACK_DAYS, apply_penalisations


class Command(BaseCommand):
    help = (
        "Auto-apply Penalisations for every active employee's unexplained, "
        "un-regularised absences once the grace period has lapsed. Idempotent — "
        "safe to re-run."
    )

    def add_arguments(self, parser):
        help_text = (
            f"How far back to scan for un-penalised absences (default {DEFAULT_LOOKBACK_DAYS})."
        )
        parser.add_argument(
            "--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS, help=help_text
        )

    def handle(self, *args, **options):
        created = apply_penalisations(lookback_days=options["lookback_days"])
        self.stdout.write(self.style.SUCCESS(f"Applied {created} new penalisation(s)."))
