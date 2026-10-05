"""Describe the employee-scoped payroll endpoint once; the core's conformance
kit proves it honours RBAC scoping (used by `manage.py verify_payroll` and
pytest). Payroll profiles are maintained by HR/Payroll, not self-submitted, so
the create-owner check does not apply (create_payload is None). The guarantee
under test is read scoping: an Employee sees only themselves, a Manager their
team, HR/Finance everyone."""

import datetime

from core.conformance import ScopedEndpoint
from payroll.models import EmployeePayrollProfile

ENDPOINT = ScopedEndpoint(
    label="Payroll employees",
    list_url="/api/v1/payroll/employees/",
    detail_url=lambda pk: f"/api/v1/payroll/employees/{pk}/",
    read_permission="payroll.read",
    create_record=lambda employee: EmployeePayrollProfile.objects.create(
        employee=employee, effective_from=datetime.date(2026, 1, 1)
    ).employee_id,
    owner_of=lambda row: row["id"],
)
