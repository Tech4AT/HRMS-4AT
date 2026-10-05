import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Role, Permission, RolePermission
from core.enums import ScopeTier

User = get_user_model()

# Get superadmin user
user = User.objects.get(email='superadmin@mail.com')
role = user.role

print(f"Updating {role.name} role for {user.email}...")

# List of all permissions to grant
permission_codes = [
    'employees.read',
    'employees.write',
    'employees.personal.read',
    'employees.personal.write',
    'payroll.read',
    'payroll.write',
    'payroll.manage',
    'roles.manage',
    'org.manage',
    'scope.all',
]

# Create/link all permissions
for code in permission_codes:
    perm, created = Permission.objects.get_or_create(code=code)
    rp, created = RolePermission.objects.get_or_create(
        role=role,
        permission=perm,
        defaults={'scope_tier': ScopeTier.ALL}
    )
    status = "✅ Created" if created else "📌 Exists"
    print(f"{status}: {code}")

# Also ensure the user has is_superuser flag set for compatibility
user.is_superuser = True
user.is_staff = True
user.save()

print(f"\n✅ Superadmin {user.email} now has all permissions!")
print(f"   - Role: {role.name}")
print(f"   - is_superuser: {user.is_superuser}")
print(f"   - Permissions: {len(permission_codes)} assigned")
