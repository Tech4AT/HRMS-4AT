"""Dev/test-only: one login per starter role, for manual walkthroughs and as
fixtures for the API test suite (docs/TASKS.md build sequence step 7). Not
`createinitialadmin` (docs/TASKS.md P1-E1-08, still unbuilt) — that's the
single production bootstrap account; this is four disposable demo accounts.
Never run against a real environment. Idempotent — safe to re-run."""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Role
from employees.models import Employee

User = get_user_model()

DEMO_PASSWORD = "DemoPass123!"

DEMO_USERS = [
    {
        "email": "demo.employee@hrms.local",
        "first_name": "Elena",
        "last_name": "Employee",
        "role_name": "Employee",
        "employee_code": "DEMO-EMP",
        "manager_code": "DEMO-MGR",
    },
    {
        "email": "demo.manager@hrms.local",
        "first_name": "Marcus",
        "last_name": "Manager",
        "role_name": "Manager",
        "employee_code": "DEMO-MGR",
        "manager_code": None,
    },
    {
        "email": "demo.hradmin@hrms.local",
        "first_name": "Harper",
        "last_name": "Admin",
        "role_name": "HR Admin",
        "employee_code": "DEMO-HRA",
        "manager_code": None,
    },
    {
        "email": "demo.finance@hrms.local",
        "first_name": "Farah",
        "last_name": "Finance",
        "role_name": "Finance",
        "employee_code": "DEMO-FIN",
        "manager_code": None,
    },
]


class Command(BaseCommand):
    help = "Seed one demo login per starter role (Employee/Manager/HR Admin/Finance)."

    @transaction.atomic
    def handle(self, *args, **options):
        employees_by_code = {}

        # Pass 1: users + employees, manager assigned in pass 2 so ordering
        # in DEMO_USERS doesn't matter.
        for row in DEMO_USERS:
            role = Role.objects.get(name=row["role_name"])
            user, created = User.objects.get_or_create(
                email=row["email"],
                defaults={
                    "username": row["email"],
                    "first_name": row["first_name"],
                    "last_name": row["last_name"],
                },
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=["password"])
                user.roles.add(role)
            elif set(user.roles.values_list("pk", flat=True)) != {role.pk}:
                user.roles.set([role])

            employee, _ = Employee.objects.get_or_create(
                user=user, defaults={"employee_code": row["employee_code"]}
            )
            employees_by_code[row["employee_code"]] = employee

            status = "created" if created else "exists"
            self.stdout.write(f"  {row['email']} ({row['role_name']}) — {status}")

        # Pass 2: wire up the manager relationship.
        for row in DEMO_USERS:
            if row["manager_code"] is None:
                continue
            employee = employees_by_code[row["employee_code"]]
            manager = employees_by_code[row["manager_code"]]
            if employee.manager_id != manager.id:
                employee.manager = manager
                employee.save(update_fields=["manager"])

        self.stdout.write(self.style.SUCCESS(f"Done. Password for all demo users: {DEMO_PASSWORD}"))
