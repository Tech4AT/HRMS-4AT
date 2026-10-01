import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

# Delete if exists
User.objects.filter(email='finance@company.com').delete()

# Create new user
user = User.objects.create_user(
    email='finance@company.com',
    password='password123',
    first_name='Finance',
    last_name='Manager'
)
user.is_staff = True
user.is_superuser = True
user.save()

print(f"✅ User created: {user.email}")
print(f"   Password: password123")
