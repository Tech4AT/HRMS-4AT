"""Assigns each employee a Role based on their Designation. A one-time
business decision (which title maps to which role), not something inferred
generically — see DESIGNATION_TO_ROLE below, confirmed with the stakeholder
rather than guessed:

- CEO/Managing Partner/Associate Partner/Head of Consulting -> a new
  "Executive" role (created here if missing): org-wide employees.read only,
  deliberately NOT roles.manage — RBAC administration stays HR Admin's job,
  not a general executive one.
- Manager/Assistant Manager/Product Development Manager -> Manager
- HR Lead/Talent Acquisition Lead -> HR Admin
- Finance Executive -> Finance
- Everything else (Senior I/II/III, Staff, Senior Staff, Contractor,
  Application Development and AI Engineer) -> Employee

Idempotent — only touches users whose role actually needs to change, and
every change is audited (docs/REQUIREMENTS.md's "audit everything"),
consistent with role changes made through UserViewSet.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Permission, Role
from audit.service import write_audit
from core.enums import RoleArchetype, ScopeTier
from employees.models import Employee

DESIGNATION_TO_ROLE = {
    "CEO": "Executive",
    "Managing Partner": "Executive",
    "Associate Partner": "Executive",
    "Head of Consulting": "Executive",
    "Manager": "Manager",
    "Assistant Manager": "Manager",
    "Product Development Manager": "Manager",
    "HR Lead": "HR Admin",
    "Talent Acquisition Lead": "HR Admin",
    "Finance Executive": "Finance",
    "Senior I": "Employee",
    "Senior II": "Employee",
    "Senior III": "Employee",
    "Staff": "Employee",
    "Senior Staff": "Employee",
    "Contractor": "Employee",
    "Application Development and AI Engineer": "Employee",
}


class Command(BaseCommand):
    help = "Assign Role to every Employee based on their Designation."

    @transaction.atomic
    def handle(self, *args, **options):
        self._ensure_executive_role()

        roles_by_name = {r.name: r for r in Role.objects.all()}
        updated, unchanged, unmapped = 0, 0, []

        employees = Employee.objects.select_related("user", "designation").prefetch_related(
            "user__roles"
        )
        for employee in employees:
            designation_name = employee.designation.name if employee.designation else None
            role_name = DESIGNATION_TO_ROLE.get(designation_name)

            if role_name is None:
                unmapped.append((employee.employee_code, designation_name))
                continue

            role = roles_by_name[role_name]
            user = employee.user
            if set(user.roles.values_list("pk", flat=True)) == {role.id}:
                unchanged += 1
                continue

            before_roles = sorted(user.roles.values_list("name", flat=True))
            user.roles.set([role])
            write_audit(
                None,
                "User.role_changed",
                "User",
                user.pk,
                {
                    "before": {"roles": before_roles},
                    "after": {"roles": [role.name]},
                    "reason": "assign_roles_by_designation",
                },
            )
            updated += 1

        self.stdout.write(self.style.SUCCESS(f"Done. {updated} updated, {unchanged} unchanged."))
        if unmapped:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(unmapped)} employee(s) have a designation not in "
                    "DESIGNATION_TO_ROLE — left untouched:"
                )
            )
            for code, designation in unmapped:
                self.stdout.write(f"  {code}: {designation!r}")

    def _ensure_executive_role(self):
        role, created = Role.objects.get_or_create(
            name="Executive", defaults={"archetype": RoleArchetype.SUPERADMIN}
        )
        if created:
            self.stdout.write("Created 'Executive' role.")

        permission = Permission.objects.get(code="employees.read")
        _, created = role.role_permissions.get_or_create(
            permission=permission, defaults={"scope_tier": ScopeTier.ALL}
        )
        if created:
            self.stdout.write("Granted Executive: employees.read @ all.")
