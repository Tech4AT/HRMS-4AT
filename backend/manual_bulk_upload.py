import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.test import Client
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model

User = get_user_model()

# Get the superadmin user
user = User.objects.get(email='superadmin@mail.com')

# Generate token
refresh = RefreshToken.for_user(user)
access_token = str(refresh.access_token)

# Test /api/employees endpoint
client = Client()

# Try without file first
response = client.post(
    '/api/v1/employees/bulk-upload/',
    HTTP_AUTHORIZATION=f'Bearer {access_token}',
    HTTP_CONTENT_TYPE='application/json'
)

print(f"Response status: {response.status_code}")
print(f"Response content: {response.content.decode()}")

# Also test if the endpoint exists
response2 = client.options(
    '/api/v1/employees/bulk-upload/',
    HTTP_AUTHORIZATION=f'Bearer {access_token}'
)
print(f"\nOPTIONS status: {response2.status_code}")
