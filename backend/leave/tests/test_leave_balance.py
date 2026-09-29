import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from leave.models import LeaveBalance, LeaveType

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/balance"


def _client():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


def test_balance_is_lazily_created_from_the_types_annual_allocation():
    LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    client, employee = _client()

    response = client.get(URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["allocated"] == "6.0"
    assert data[0]["entitled"] == "6.0"
    assert data[0]["available"] == "6.0"
    year = str(timezone.localdate().year)
    assert LeaveBalance.objects.filter(employee=employee, financial_year=year).exists()


def test_inactive_types_are_excluded():
    LeaveType.objects.create(
        name="Retired Leave",
        annual_allocation=5,
        status=LeaveType._meta.get_field("status").default,
    )
    inactive = LeaveType.objects.create(name="Old Type", annual_allocation=5)
    inactive.status = "inactive"
    inactive.save(update_fields=["status"])
    client, _ = _client()

    response = client.get(URL)

    names = {row["leave_type_id"] for row in response.json()["data"]}
    assert str(inactive.pk) not in names


def test_only_sees_own_balance():
    LeaveType.objects.create(name="Casual Leave", annual_allocation=6)
    client_a, employee_a = _client()
    client_b, _ = _client()

    client_a.get(URL)  # lazily creates employee_a's balance
    response_b = client_b.get(URL)

    year = str(timezone.localdate().year)
    balance_a = LeaveBalance.objects.get(employee=employee_a, financial_year=year)
    assert str(balance_a.pk) not in {row["id"] for row in response_b.json()["data"]}
