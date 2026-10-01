import csv
import openpyxl
from pathlib import Path
from datetime import datetime
from django.core.management.base import BaseCommand
from django.db import transaction
from employees.models import Employee, Department, Designation
from accounts.models import User


class Command(BaseCommand):
    help = 'Import employees from roster CSV or XLSX file'

    def add_arguments(self, parser):
        parser.add_argument('roster_file', type=str, help='Path to CSV or XLSX file')

    @transaction.atomic
    def handle(self, *args, **options):
        roster_file = options['roster_file']
        file_path = Path(roster_file)

        if not file_path.exists():
            self.stdout.write(self.style.ERROR(f'File not found: {roster_file}'))
            return

        created_count = 0
        updated_count = 0
        skipped_count = 0

        # Create default department/designation
        default_dept, _ = Department.objects.get_or_create(
            name='General', defaults={'is_active': True}
        )
        default_desig, _ = Designation.objects.get_or_create(
            name='Staff', defaults={'is_active': True}
        )

        manager_map = {}

        # Read data from CSV or XLSX
        rows = []
        if file_path.suffix.lower() == '.xlsx':
            wb = openpyxl.load_workbook(file_path)
            ws = wb.active
            # Headers are on row 3
            headers = [cell.value for cell in ws[3]]
            for row in ws.iter_rows(min_row=4, values_only=True):
                row_dict = dict(zip(headers, row))
                rows.append(row_dict)
        else:
            with open(file_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)

        employees_to_create = []

        for row in rows:
            emp_code = row.get('Employee Number', '').strip() if row.get('Employee Number') else ''
            first_name = row.get('First Name', '').strip() if row.get('First Name') else ''
            last_name = row.get('Last Name', '').strip() if row.get('Last Name') else ''
            email = row.get('Reporting Manager Email', '').strip() if row.get('Reporting Manager Email') else ''
            job_title = row.get('Job Title', '').strip() if row.get('Job Title') else ''
            department = row.get('Department', '').strip() if row.get('Department') else ''
            status = row.get('Employment Status', 'Working').strip() if row.get('Employment Status') else 'Working'
            reporting_manager = row.get('Reporting Manager', '').strip() if row.get('Reporting Manager') else ''
            date_joined = row.get('Date Joined')

            # Skip if no employee code or name
            if not emp_code or not first_name:
                skipped_count += 1
                continue

            # Generate email if not provided
            if not email:
                email = f'{first_name.lower()}.{last_name.lower()}@consult-4at.com'

            # Parse date
            date_of_joining = None
            if date_joined:
                try:
                    if isinstance(date_joined, str):
                        date_of_joining = datetime.strptime(date_joined.strip(), '%d-%b-%Y').date()
                    elif hasattr(date_joined, 'date'):
                        # Already a datetime object from openpyxl
                        date_of_joining = date_joined.date()
                except:
                    pass

            # Get or create department
            try:
                dept = Department.objects.get(name=department)
            except Department.DoesNotExist:
                dept = default_dept

            # Get or create designation
            try:
                desig = Designation.objects.get(name=job_title)
            except Designation.DoesNotExist:
                desig = default_desig

            # Convert status
            emp_status = 'active' if status == 'Working' else 'inactive'

            employees_to_create.append({
                'emp_code': emp_code,
                'first_name': first_name,
                'last_name': last_name,
                'email': email,
                'department': dept,
                'designation': desig,
                'status': emp_status,
                'date_of_joining': date_of_joining,
                'reporting_manager_name': reporting_manager,
            })

        # Create users and employees
        for emp_data in employees_to_create:
            try:
                # Generate username from email or employee code
                username = emp_data['email'].split('@')[0].lower()

                # Create or get user
                user, user_created = User.objects.get_or_create(
                    email=emp_data['email'],
                    defaults={
                        'username': username,
                        'first_name': emp_data['first_name'],
                        'last_name': emp_data['last_name'],
                    }
                )

                # Create or update employee
                employee, created = Employee.objects.update_or_create(
                    employee_code=emp_data['emp_code'],
                    defaults={
                        'user': user,
                        'department': emp_data['department'],
                        'designation': emp_data['designation'],
                        'status': emp_data['status'],
                        'date_of_joining': emp_data['date_of_joining'],
                    }
                )

                if created:
                    created_count += 1
                else:
                    updated_count += 1

                # Store manager name for later linking
                if emp_data['reporting_manager_name']:
                    manager_map[employee.id] = emp_data['reporting_manager_name']

            except Exception as e:
                self.stdout.write(
                    self.style.WARNING(f'Error creating employee {emp_data["emp_code"]}: {str(e)}')
                )
                skipped_count += 1

        # Now link managers
        linked_managers = 0
        for employee_id, manager_name in manager_map.items():
            try:
                employee = Employee.objects.get(id=employee_id)
                # Find manager by first name
                first_name = manager_name.split()[0] if manager_name else ''
                manager = Employee.objects.filter(
                    user__first_name__icontains=first_name
                ).first()

                if manager:
                    employee.manager = manager
                    employee.save()
                    linked_managers += 1
            except Exception as e:
                self.stdout.write(
                    self.style.WARNING(f'Error linking manager for {employee_id}: {str(e)}')
                )

        self.stdout.write(
            self.style.SUCCESS(
                f'✓ Import complete\n'
                f'  Created: {created_count}\n'
                f'  Updated: {updated_count}\n'
                f'  Managers linked: {linked_managers}\n'
                f'  Skipped: {skipped_count}'
            )
        )
