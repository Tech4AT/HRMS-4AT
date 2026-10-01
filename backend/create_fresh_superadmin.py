import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Role, Permission, RolePermission
from core.enums import ScopeTier

User = get_user_model()

# Delete if exists
User.objects.filter(email='superadmin@mail.com').delete()

# Get or create Superadmin role
role, _ = Role.objects.get_or_create(
    name='Superadmin',
    defaults={'archetype': 'superadmin', 'is_active': True}
)

# Ensure it has the right archetype
role.archetype = 'superadmin'
role.save()

# List of permissions to grant to superadmin
permission_codes = [
    'employees.read',
    'employees.write',
    'payroll.read',
    'payroll.write',
    'roles.manage',
    'org.manage',
]

# Create permissions and link them to the role
for code in permission_codes:
    perm, _ = Permission.objects.get_or_create(code=code)
    RolePermission.objects.get_or_create(
        role=role,
        permission=perm,
        defaults={'scope_tier': ScopeTier.ALL}
    )

# Create new superadmin user
user = User.objects.create_superuser(
    email='superadmin@mail.com',
    username='superadmin@mail.com',
    password='SuperAdmin@123',
    first_name='Super',
    last_name='Admin',
)
user.role = role
user.save()

print("✅ New Superadmin User Created!")
print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print(f"Email:    superadmin@mail.com")
print(f"Password: SuperAdmin@123")
print(f"Role:     Superadmin")
print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print(f"\nLogin at: http://localhost:3001/login")
