import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Role

User = get_user_model()

# List all existing roles
print("Existing roles:")
for role in Role.objects.all():
    print(f"  - {role.name} (archetype: {role.archetype})")

# Get or create Superadmin role with correct archetype
role, created = Role.objects.get_or_create(
    name='Superadmin',
    defaults={'archetype': 'superadmin', 'is_active': True}
)

if created:
    print(f"\n✅ Created Superadmin role")
else:
    # Update archetype if it exists
    role.archetype = 'superadmin'
    role.save()
    print(f"\n✅ Updated Superadmin role archetype to 'superadmin'")

# Get the admin user and assign the role
try:
    user = User.objects.get(email='admin@hrms.local')
    user.role = role
    user.save()
    print(f"✅ Assigned Superadmin role to admin@hrms.local")
    print(f"   - is_superuser: {user.is_superuser}")
    print(f"   - role: {user.role.name}")
    print(f"   - role archetype: {user.role.archetype}")
except User.DoesNotExist:
    print("❌ admin@hrms.local user not found")
