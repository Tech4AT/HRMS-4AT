import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.test import Client
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model

User = get_user_model()

# Get the admin user
try:
    user = User.objects.get(email='admin@hrms.local')
    print(f"Admin user found:")
    print(f"  - Email: {user.email}")
    print(f"  - is_superuser: {user.is_superuser}")
    print(f"  - role: {user.role.name if user.role else 'None'}")
    print(f"  - role archetype: {user.role.archetype if user.role else 'None'}")

    # Generate token
    refresh = RefreshToken.for_user(user)
    access_token = str(refresh.access_token)

    # Test /api/users/me endpoint
    client = Client()
    response = client.get(
        '/api/v1/users/me',
        HTTP_AUTHORIZATION=f'Bearer {access_token}'
    )

    print(f"\n/api/users/me response:")
    print(f"  Status: {response.status_code}")
    data = response.json()
    print(f"  Response: {json.dumps(data, indent=2)}")

except User.DoesNotExist:
    print("❌ admin@hrms.local user not found")
