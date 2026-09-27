"""Seed (or remove) a small, clearly-fictional demo organisation with real logins,
for walking through RBAC by hand in the frontend or the API.

    python manage.py seed_demo_org                # create or refresh (idempotent)
    python manage.py seed_demo_org --with-leave   # also one example leave request each
    python manage.py seed_demo_org --remove       # delete exactly what this created

Same eight people, hierarchy, departments, locations and legal entities as the
verification harness (core/fictional_org.py), but persistent: logins are
`demo.<name>@hrms.local` / DemoPass123!, employee codes are `DEMO-<NAME>`, and
every department, location and entity is prefixed "Demo". Dev and test only,
never production. The real employees are not touched.

    Dana (Manager) > Maya (Manager) > Eli, Eve (Employees)
    Omar (Manager) > Sam (Employee)
    Hana (HR Admin), Finn (Finance)
"""

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role
from core.fictional_org import PEOPLE
from employees.models import Department, Employee, LegalEntity, Location

User = get_user_model()

PASSWORD = "DemoPass123!"
DOMAIN = "hrms.local"


def email_for(key):
    return f"demo.{key}@{DOMAIN}"


class Command(BaseCommand):
    help = "Create or remove a fictional demo organisation with working logins (dev only)."

    def add_arguments(self, parser):
        parser.add_argument("--remove", action="store_true", help="Delete the demo organisation.")
        parser.add_argument(
            "--with-leave",
            action="store_true",
            help="Also create one example leave request per person (needs example_leave).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if settings.SETTINGS_MODULE.endswith(".prod"):
            raise CommandError("seed_demo_org does not run under production settings.")
        if options["remove"]:
            return self._remove()
        self._create(options["with_leave"])

    # -- create -------------------------------------------------------------

    def _create(self, with_leave):
        entities = {
            "A": LegalEntity.objects.get_or_create(name="Demo Entity A")[0],
            "B": LegalEntity.objects.get_or_create(name="Demo Entity B")[0],
        }
        employees = {}
        for key, first, last, role_name, dept, location, entity, _manager in PEOPLE:
            role = Role.objects.get(name=role_name)
            user, created = User.objects.get_or_create(
                email=email_for(key),
                defaults={
                    "username": email_for(key),
                    "first_name": first,
                    "last_name": last,
                },
            )
            if created:
                user.set_password(PASSWORD)
                user.save(update_fields=["password"])
                user.roles.add(role)
            elif set(user.roles.values_list("pk", flat=True)) != {role.pk}:
                user.roles.set([role])
            employee, _ = Employee.objects.update_or_create(
                user=user,
                defaults={
                    "employee_code": f"DEMO-{key.upper()}",
                    "department": Department.objects.get_or_create(name=f"Demo {dept}")[0],
                    "location": Location.objects.get_or_create(name=f"Demo {location}")[0],
                    "legal_entity": entities[entity],
                },
            )
            employees[key] = employee
            self.stdout.write(
                f"  {email_for(key):<30} {role_name:<9} {'created' if created else 'exists'}"
            )

        for key, *_middle, manager_key in PEOPLE:
            manager = employees[manager_key] if manager_key else None
            if employees[key].manager_id != (manager.pk if manager else None):
                employees[key].manager = manager
                employees[key].save(update_fields=["manager"])

        if with_leave:
            self._leave_requests(employees)
        self.stdout.write(self.style.SUCCESS(f"Done. Password for every demo login: {PASSWORD}"))

    def _leave_requests(self, employees):
        if not apps.is_installed("example_leave"):
            raise CommandError("--with-leave needs the example_leave app (dev/test settings).")
        from example_leave.models import LeaveRequest

        for key, employee in employees.items():
            LeaveRequest.objects.get_or_create(
                employee=employee, reason=f"Demo request from {employee.user.first_name}"
            )
        self.stdout.write("  example leave requests: one per person")

    # -- remove -------------------------------------------------------------

    def _remove(self):
        emails = [email_for(key) for key, *_ in PEOPLE]
        # Users cascade to their Employee rows (and any records keyed to them).
        deleted, _ = User.objects.filter(email__in=emails).delete()
        Department.objects.filter(name__startswith="Demo ", employees__isnull=True).delete()
        Location.objects.filter(name__startswith="Demo ", employees__isnull=True).delete()
        LegalEntity.objects.filter(name__startswith="Demo Entity", employees__isnull=True).delete()
        self.stdout.write(self.style.SUCCESS(f"Removed the demo organisation ({deleted} rows)."))
