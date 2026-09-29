"""Loads the real employee roster from data/employee_directory.csv into
Department/Designation/Location/Employee. Idempotent (get_or_create by email/
name), safe to re-run as the CSV is corrected or extended.

This repo is public. data/employee_directory.csv is gitignored
(backend/**/management/commands/data/ in .gitignore) and must stay that way —
it is real names and real emails, including a few personal (non-corporate)
addresses. The file lives in a private location outside this repo; fetch the
current version from there before running this command, don't try to source
it from git history or re-add it with -f.

Deliberately leaves Employee.manager unset for everyone — the org tree/
reporting hierarchy is a separate follow-up (apply_org_tree, not built yet)
once that data is available, so this command never has to guess at it.

Every created User gets an unusable password (Django's set_unusable_password)
rather than a shared default — these are real people's provisioned accounts,
not disposable test fixtures like seed_demo_users, so a guessable shared
password would be a real credential weakness, not a convenience. No Role is
assigned either: mapping ~90 real job titles to Employee/Manager/HR Admin/
Finance is a business decision for whoever owns that call, not something to
infer from a designation string.
"""

import csv
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from employees.models import Department, Employee, JobTitle, Location

User = get_user_model()

CSV_PATH = Path(__file__).parent / "data" / "employee_directory.csv"

# Department names that came through as "Parent > Parent" (no real
# sub-department) or truncated with "..." in the source UI — see the CSV's
# department_child column, which is left blank for the former. Rows whose
# department_child ends up here are ones where the source screenshot itself
# truncated the value with an ellipsis; the full string is a guess, not a
# transcription, and should be confirmed against the real system of record.
UNCERTAIN_DEPARTMENTS = {"SOX/ Design & Implimentation"}


class Command(BaseCommand):
    help = "Import the employee directory CSV into Department/Designation/Location/Employee."

    def handle(self, *args, **options):
        rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig")))
        self.stdout.write(f"Loaded {len(rows)} rows from {CSV_PATH.name}")

        with transaction.atomic():
            location_cache = {}
            department_cache = {}
            designation_cache = {}

            created_count = 0
            existing_count = 0

            for row in rows:
                location = self._get_or_create(location_cache, Location, row["location"])
                designation = self._get_or_create(
                    designation_cache, JobTitle, row["designation"]
                )
                department = self._get_department(department_cache, row)

                first_name, _, last_name = row["name"].strip().partition(" ")
                email = row["email"].strip()
                employee_code = email.split("@", 1)[0].upper()

                user = User.objects.filter(email__iexact=email).first()
                user_created = user is None
                if user_created:
                    user = User(
                        email=email,
                        username=email,
                        first_name=first_name,
                        last_name=last_name,
                    )
                    user.set_unusable_password()
                    user.save()

                employee, employee_created = Employee.objects.get_or_create(
                    user=user,
                    defaults={
                        "employee_code": employee_code,
                        "department": department,
                        "designation": designation,
                        "location": location,
                    },
                )
                if employee_created:
                    created_count += 1
                else:
                    existing_count += 1

            self.stdout.write(
                self.style.SUCCESS(
                    f"Done. {created_count} employees created, {existing_count} already existed."
                )
            )
            uncertain = UNCERTAIN_DEPARTMENTS & set(department_cache.keys())
            if uncertain:
                self.stdout.write(
                    self.style.WARNING(
                        "Department name(s) reconstructed from a truncated source label, "
                        f"not a verbatim transcription — confirm before relying on them: "
                        f"{', '.join(sorted(uncertain))}"
                    )
                )

    def _get_or_create(self, cache, model, name):
        name = name.strip()
        if name not in cache:
            obj, _ = model.objects.get_or_create(name=name)
            cache[name] = obj
        return cache[name]

    def _get_department(self, cache, row):
        parent_name = row["department_parent"].strip()
        child_name = row["department_child"].strip()

        parent = self._get_or_create(cache, Department, parent_name)
        if not child_name or child_name == parent_name:
            return parent

        cache_key = f"{parent_name} > {child_name}"
        if cache_key not in cache:
            child, _ = Department.objects.get_or_create(
                name=child_name, defaults={"parent": parent}
            )
            if child.parent_id != parent.id:
                child.parent = parent
                child.save(update_fields=["parent"])
            cache[cache_key] = child
        return cache[cache_key]
