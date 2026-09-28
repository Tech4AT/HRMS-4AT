"""Bulk-provision temporary logins for employees who cannot log in yet.

Employees imported from the real directory get an unusable password
(`set_unusable_password`), so they cannot log in at all. This command gives
each such employee-linked active user a random temporary password and flags
them `must_change_password=True` (T06's forced-change flow then requires them
to change it on first login).

Credential distribution is the human's job: this command only creates the
passwords and writes an export CSV — it NEVER sends email or any external
message. The CSV default lives under `backend/verification-reports/`, which
is gitignored; never commit it.
"""

import csv
import secrets
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from audit.service import write_audit
from employees.models import Employee


class Command(BaseCommand):
    help = (
        "Set a random temporary password + must_change_password for every "
        "active employee-linked user whose password is unusable."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report counts without changing anything (no passwords, no audit, no CSV).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Also reset users who already have a usable password.",
        )
        parser.add_argument(
            "--out",
            default=None,
            help=(
                "CSV export path (columns: email,temporary_password). "
                "Default: backend/verification-reports/provision_logins.csv "
                "(gitignored — never commit it)."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        force = options["force"]
        out = Path(options["out"]) if options["out"] else (
            Path(settings.BASE_DIR) / "verification-reports" / "provision_logins.csv"
        )

        employees = (
            Employee.objects.select_related("user")
            .filter(user__is_active=True)
            .order_by("user__email")
        )

        targets = []
        skipped = 0
        for employee in employees:
            user = employee.user
            if user.has_usable_password() and not force:
                skipped += 1
                continue
            targets.append(user)

        if dry_run:
            self.stdout.write(
                f"Dry run: would provision {len(targets)} user(s), "
                f"skip {skipped} (already usable). No changes made."
            )
            return

        provisioned = []
        for user in targets:
            temp_password = secrets.token_urlsafe(12)
            user.set_password(temp_password)
            user.must_change_password = True
            user.save(update_fields=["password", "must_change_password"])
            write_audit(None, "User.login_provisioned", "User", user.pk)
            provisioned.append((user.email, temp_password))

        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["email", "temporary_password"])
            writer.writerows(provisioned)

        self.stdout.write(
            self.style.SUCCESS(
                f"Provisioned {len(provisioned)} user(s), skipped {skipped} "
                f"(already usable). Export: {out}"
            )
        )
