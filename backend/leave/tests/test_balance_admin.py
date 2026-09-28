from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import BusinessUnit
from leave.models import LeaveBalance, LeaveType

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/leave/balances/admin"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


def test_anonymous_is_401():
    assert APIClient().get(LIST_URL).status_code == 401


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_roles_without_attendance_settings_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(LIST_URL).status_code == 403
    assert client.patch(f"{LIST_URL}/1", {"balances": []}, format="json").status_code == 403


def test_list_seeds_and_returns_every_active_employees_balance():
    department = DepartmentFactory(name="Technology")
    business_unit = BusinessUnit.objects.create(name="Tech Division")
    employee = EmployeeFactory(department=department, business_unit=business_unit)
    LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.get(LIST_URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["leaveTypes"] == [
        {"id": str(LeaveType.objects.get().pk), "name": "Casual Leave", "annualAllocation": "12.0"}
    ]
    row = next(e for e in data["employees"] if e["id"] == str(employee.pk))
    assert row["employeeCode"] == employee.employee_code
    assert row["department"] == "Technology"
    assert row["businessUnit"] == "Tech Division"
    assert row["balances"] == [
        {
            "leaveTypeId": str(LeaveType.objects.get().pk),
            "used": "0.0",
            "allocated": "12.0",
            "carryForward": "0.0",
            "entitled": "12.0",
            "available": "12.0",
        }
    ]


def test_exited_employees_are_excluded():
    exited = EmployeeFactory(status="exited")
    LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.get(LIST_URL)

    ids = {e["id"] for e in response.json()["data"]["employees"]}
    assert str(exited.pk) not in ids


def test_patch_adjusts_used_and_writes_audit():
    employee = EmployeeFactory()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()
    client.get(LIST_URL)  # seed

    response = client.patch(
        f"{LIST_URL}/{employee.pk}",
        {"balances": [{"leaveTypeId": str(leave_type.pk), "used": "4.5"}]},
        format="json",
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["balances"][0]["used"] == "4.5"
    assert data["balances"][0]["available"] == "7.5"
    year = str(timezone.localdate().year)
    balance = LeaveBalance.objects.get(
        employee=employee, leave_type=leave_type, financial_year=year
    )
    assert balance.used == Decimal("4.5")
    assert AuditLog.objects.filter(
        action="LeaveBalance.admin_adjusted", entity_id=str(balance.pk)
    ).exists()


def test_patch_rejects_used_exceeding_entitled():
    employee = EmployeeFactory()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.patch(
        f"{LIST_URL}/{employee.pk}",
        {"balances": [{"leaveTypeId": str(leave_type.pk), "used": "999"}]},
        format="json",
    )

    assert response.status_code == 400


def test_patch_rejects_negative_used():
    employee = EmployeeFactory()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.patch(
        f"{LIST_URL}/{employee.pk}",
        {"balances": [{"leaveTypeId": str(leave_type.pk), "used": "-1"}]},
        format="json",
    )

    assert response.status_code == 400


def test_patch_rejects_a_non_numeric_used_value_without_a_500():
    employee = EmployeeFactory()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.patch(
        f"{LIST_URL}/{employee.pk}",
        {"balances": [{"leaveTypeId": str(leave_type.pk), "used": "not-a-number"}]},
        format="json",
    )

    assert response.status_code == 400


def test_patch_unknown_employee_is_404():
    LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("12"))
    client, _ = _hr_client()

    response = client.patch(
        f"{LIST_URL}/999999", {"balances": [{"leaveTypeId": "1", "used": "1"}]}, format="json"
    )

    assert response.status_code == 404


def test_patch_unknown_leave_type_is_rejected():
    employee = EmployeeFactory()
    client, _ = _hr_client()

    response = client.patch(
        f"{LIST_URL}/{employee.pk}",
        {"balances": [{"leaveTypeId": "999999", "used": "1"}]},
        format="json",
    )

    assert response.status_code == 400
