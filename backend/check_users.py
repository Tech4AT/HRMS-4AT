import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

users = User.objects.all()
print(f"Total users: {users.count()}")
for u in users:
    print(f"  - {u.email} (staff: {u.is_staff}, superuser: {u.is_superuser})")
