import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
import django
django.setup()

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from django.test import Client

User = get_user_model()
superadmin = User.objects.filter(email__icontains='superadmin').first()

if superadmin:
    refresh = RefreshToken.for_user(superadmin)
    access_token = str(refresh.access_token)

    client = Client()
    response = client.get(
        '/api/v1/employees/',
        HTTP_AUTHORIZATION=f'Bearer {access_token}'
    )

    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Success! Got {len(data.get('data', []))} employees")
    else:
        print(f"❌ Error:")
        print(response.content.decode()[:500])
else:
    print("No superadmin user found")
