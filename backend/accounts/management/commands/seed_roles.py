from django.core.management.base import BaseCommand

from accounts.models import ROLE_EMPLOYEE, ROLE_FINANCE, ROLE_HR_ADMIN, ROLE_MANAGER, Role

# Dot-notation permission strings (docs/README.md conflicts section — dot,
# not colon, per tasks.md's override). Only codes for modules that actually
# exist in this codebase today (employees, documents, onboarding) — no
# placeholder codes for unbuilt modules.
EMPLOYEE_PERMS = [
    'employee.read.self',
    'onboarding.read.self',
    'onboarding.update.self',
    'documents.read.self',
    'documents.write.self',
]

MANAGER_PERMS = EMPLOYEE_PERMS + [
    'employee.read.team',
    'onboarding.read.team',
    'documents.read.team',
]

HR_ADMIN_PERMS = [
    'scope.all',
    'employee.read.org',
    'employee.write',
    'onboarding.manage',
    'documents.manage',
]

FINANCE_PERMS = [
    'employee.read.self',
]

ROLE_PERMISSIONS = {
    ROLE_EMPLOYEE: EMPLOYEE_PERMS,
    ROLE_MANAGER: MANAGER_PERMS,
    ROLE_HR_ADMIN: HR_ADMIN_PERMS,
    ROLE_FINANCE: FINANCE_PERMS,
}


class Command(BaseCommand):
    help = 'Idempotently seed the 4 MVP roles and their permission strings.'

    def handle(self, *args, **options):
        for name, perms in ROLE_PERMISSIONS.items():
            role, created = Role.objects.update_or_create(name=name, defaults={'permissions': perms})
            verb = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f'{verb} role "{name}" with {len(perms)} permissions'))
