"""docs/TASKS.md P1-E1-08 — the production bootstrap: creates the first HR
Admin (or equivalent) user from env vars if one doesn't already exist, and
does nothing (not error) if run again. This is how the very first login into
a fresh environment happens (dev, CI, staging, prod alike), so it has to be
idempotent and safe to run on every deploy, unlike seed_demo_users (disposable
test fixtures) or import_employee_directory (a one-time real-roster load)."""

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, User
from employees.models import Employee


class Command(BaseCommand):
    help = "Create the first admin user from INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD env vars."

    @transaction.atomic
    def handle(self, *args, **options):
        email = os.environ.get("INITIAL_ADMIN_EMAIL")
        password = os.environ.get("INITIAL_ADMIN_PASSWORD")

        if not email or not password:
            raise CommandError("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must both be set.")

        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(f"{email} already exists — nothing to do.")
            return

        try:
            hr_admin_role = Role.objects.get(name="HR Admin")
        except Role.DoesNotExist as exc:
            raise CommandError(
                "No 'HR Admin' role found — run migrate first "
                "(accounts.0002_seed_starter_roles seeds it)."
            ) from exc

        user = User.objects.create_user(
            username=email,
            email=email,
            password=password,
            first_name="Admin",
            last_name="",
            is_staff=True,
            is_superuser=True,
        )
        user.roles.add(hr_admin_role)
        Employee.objects.create(user=user, employee_code=email.split("@", 1)[0].upper())

        self.stdout.write(self.style.SUCCESS(f"Created initial admin: {email}"))
