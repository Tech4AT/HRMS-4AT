import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Role

User = get_user_model()

# Delete if exists
User.objects.filter(email='admin@hrms.local').delete()

# Get or create superadmin role
role, _ = Role.objects.get_or_create(
    name='Superadmin',
    defaults={'archetype': 'superadmin', 'is_active': True}
)

# Create superuser
user = User.objects.create_superuser(
    email='admin@hrms.local',
    username='admin@hrms.local',
    password='SuperAdmin123!',
    first_name='Super',
    last_name='Admin',
)
user.role = role
user.save()

print("✅ Superadmin created!")
print(f"Email: admin@hrms.local")
print(f"Password: SuperAdmin123!")
