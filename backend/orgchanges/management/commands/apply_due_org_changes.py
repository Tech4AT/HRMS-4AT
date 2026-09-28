"""Flip due org changes to effective and write them onto the employee rows.

A change is due when it is still pending and its effective_date is today or
earlier. Each row applies in its own transaction; a row that no longer
validates (e.g. its target seat was deactivated, its manager would build a
cycle) is left pending and reported, so one stale row never blocks the rest.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from orgchanges.models import OrgChange
from orgchanges.services import apply_org_change


class Command(BaseCommand):
    help = "Apply pending org changes whose effective date has arrived."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be applied without writing anything.",
        )

    def handle(self, *args, **options):
        today = timezone.now().date()
        due = list(
            OrgChange.objects.filter(status=OrgChange.STATUS_PENDING, effective_date__lte=today)
            .select_related("employee")
            .order_by("effective_date", "pk")
        )
        if options["dry_run"]:
            for change in due:
                self.stdout.write(
                    f"[{change.pk}] {change.change_type} for employee "
                    f"{change.employee_id} (effective {change.effective_date})"
                )
            self.stdout.write(self.style.SUCCESS(f"{len(due)} change(s) due."))
            return

        applied, skipped = 0, 0
        for change in due:
            try:
                apply_org_change(change)
            except Exception as exc:  # noqa: BLE001 — one stale row must not block the rest
                skipped += 1
                self.stderr.write(f"[{change.pk}] skipped: {exc}")
                continue
            applied += 1
            self.stdout.write(
                f"[{change.pk}] {change.change_type} for employee "
                f"{change.employee_id} is now effective."
            )
        self.stdout.write(
            self.style.SUCCESS(f"Applied {applied}, skipped {skipped} (of {len(due)} due).")
        )
