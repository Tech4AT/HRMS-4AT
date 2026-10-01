import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from employees.models import Employee

employees = Employee.objects.all()
print(f"Total employees: {employees.count()}")
for e in employees:
    print(f"  - {e.first_name} {e.last_name} ({e.work_email})")
