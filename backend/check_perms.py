import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
import django
django.setup()

from django.contrib.auth import get_user_model
from core.scope import user_effective_permissions, explain_permission

User = get_user_model()

# Find superadmin user
superadmin = User.objects.filter(email__icontains='superadmin').first() or User.objects.filter(is_superuser=True).first()

if superadmin:
    print(f"✅ User: {superadmin.email}")
    print(f"   is_superuser: {superadmin.is_superuser}")
    print(f"   is_staff: {superadmin.is_staff}")
    print(f"   role: {superadmin.role}")
    print(f"\n📋 Permissions:")
    perms = user_effective_permissions(superadmin)
    if perms:
        for perm in sorted(perms):
            print(f"   ✓ {perm}")
    else:
        print("   (none)")

    print(f"\n🔍 employees.read check:")
    result = explain_permission(superadmin, "employees.read")
    print(f"   {result}")
else:
    print("❌ No superadmin user found")
    print("\nUsers in database:")
    for u in User.objects.all()[:5]:
        print(f"  - {u.email} (is_superuser={u.is_superuser}, role={u.role})")
