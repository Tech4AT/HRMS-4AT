"""Idempotently creates the IT Admin role with employees.read (all-scope)
permission so IT staff can view the employee directory and complete
it_admin-owned onboarding tasks. Also grants the asset inventory codes
(assets.read + assets.write, all-scope) so IT owns the laptop fleet."""

from django.core.management.base import BaseCommand

from accounts.models import ROLE_IT_ADMIN, Permission, Role, RolePermission
from core.enums import RoleArchetype, ScopeTier

EXTRA_GRANTS = {
    'assets.read': 'View assets within the holder\'s scope',
    'assets.write': 'Assign and update assets',
}


class Command(BaseCommand):
    help = 'Create/update the IT Admin role with employees.read permission.'

    def handle(self, *args, **options):
        role, created = Role.objects.get_or_create(
            name=ROLE_IT_ADMIN,
            defaults={'archetype': RoleArchetype.ADMIN, 'description': 'IT staff — provision equipment and accounts for new hires'},
        )
        if not created and role.archetype != RoleArchetype.ADMIN:
            role.archetype = RoleArchetype.ADMIN
            role.save(update_fields=['archetype'])

        verb = 'Created' if created else 'Found'
        self.stdout.write(f'{verb} role "{ROLE_IT_ADMIN}"')

        perm, _ = Permission.objects.get_or_create(
            code='employees.read',
            defaults={'description': 'View employee directory records within the holder\'s scope'},
        )

        rp, rp_created = RolePermission.objects.get_or_create(
            role=role,
            permission=perm,
            defaults={'scope_tier': ScopeTier.ALL},
        )
        if rp_created:
            self.stdout.write(self.style.SUCCESS(f'Granted employees.read (scope=all) to "{ROLE_IT_ADMIN}"'))
        else:
            self.stdout.write(f'employees.read already granted to "{ROLE_IT_ADMIN}" (scope={rp.scope_tier})')

        for code, description in EXTRA_GRANTS.items():
            perm, _ = Permission.objects.get_or_create(
                code=code, defaults={'description': description}
            )
            _, granted = RolePermission.objects.get_or_create(
                role=role, permission=perm, defaults={'scope_tier': ScopeTier.ALL}
            )
            if granted:
                self.stdout.write(self.style.SUCCESS(f'Granted {code} (scope=all) to "{ROLE_IT_ADMIN}"'))
            else:
                self.stdout.write(f'{code} already granted to "{ROLE_IT_ADMIN}"')
