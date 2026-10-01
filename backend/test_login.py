import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.test import Client

client = Client()

# Test login
response = client.post(
    '/api/v1/auth/login',
    data=json.dumps({
        'email': 'superadmin@mail.com',
        'password': 'SuperAdmin@123'
    }),
    content_type='application/json'
)

print(f"Status: {response.status_code}")
print(f"Response: {response.content.decode()}")
