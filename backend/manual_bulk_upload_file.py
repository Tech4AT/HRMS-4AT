import os
import django
import json
from io import BytesIO

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

# Create a test file
test_file_content = b'Employee Number,First Name,Last Name,Job Title,Department,Employment Status\n1,John,Doe,Manager,HR,Working'

# Test with file
client = Client()
response = client.post(
    '/api/v1/employees/bulk-upload/',
    {'file': ('test.csv', BytesIO(test_file_content), 'text/csv')},
    HTTP_AUTHORIZATION=f'Bearer {access_token}'
)

print(f"Response status: {response.status_code}")
print(f"Response content: {response.content.decode()}")
