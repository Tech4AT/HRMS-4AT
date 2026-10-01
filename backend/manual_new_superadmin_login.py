import os
import django
import json
import requests

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

# Test login
response = requests.post(
    'http://localhost:8000/api/v1/auth/login',
    json={
        'email': 'superadmin@mail.com',
        'password': 'SuperAdmin@123'
    }
)

print(f"Status: {response.status_code}")
data = response.json()
print(json.dumps(data, indent=2))
