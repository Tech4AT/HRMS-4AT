import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
import django
django.setup()

from django.test import Client
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model

User = get_user_model()
user = User.objects.get(email='superadmin@mail.com')
refresh = RefreshToken.for_user(user)
access_token = str(refresh.access_token)

client = Client()
response = client.get(
    '/api/v1/employees/',
    HTTP_AUTHORIZATION=f'Bearer {access_token}'
)

print(f'Status: {response.status_code}')
print(f'Content length: {len(response.content)}')
if response.status_code == 200:
    import json
    data = response.json()
    print(f'Data keys: {list(data.keys())}')
    if 'data' in data:
        print(f'Employee count: {len(data["data"])}')
else:
    print(f'Response: {response.content.decode()[:500]}')
