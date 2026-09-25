import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from leave.models import LeaveType

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/types"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


def test_anonymous_read_is_401():
    assert APIClient().get(URL).status_code == 401


def test_any_authenticated_employee_can_read():
    client, _ = _client("Employee")
    LeaveType.objects.create(name="Casual Leave", annual_allocation=6)

    response = client.get(URL)

    assert response.status_code == 200
    assert response.json()["data"][0]["name"] == "Casual Leave"


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_write_requires_attendance_settings_manage(role):
    client, _ = _client(role)

    response = client.post(URL, {"name": "Sick Leave", "annual_allocation": 10}, format="json")

    assert response.status_code == 403


def test_hr_admin_creates_a_type_with_an_auto_derived_code():
    client, _ = _hr_client()

    response = client.post(
        URL,
        {
            "name": "Annual Leave",
            "category": "Regular",
            "annual_allocation": 20,
            "carry_forward_limit": 5,
            "requires_approval": True,
            "is_paid": True,
        },
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["code"] == "ANN"
    assert data["status"] == "active"
    assert AuditLog.objects.filter(action="LeaveType.created", entity_id=str(data["id"])).exists()


def test_code_collision_gets_a_numeric_suffix():
    client, _ = _hr_client()
    client.post(URL, {"name": "Compensatory Off", "annual_allocation": 0}, format="json")

    response = client.post(
        URL, {"name": "Compensatory Leave", "annual_allocation": 0}, format="json"
    )

    assert response.status_code == 201
    assert response.json()["data"]["code"] == "COM2"


def test_code_is_never_accepted_from_the_request():
    client, _ = _hr_client()

    response = client.post(
        URL, {"name": "Bereavement Leave", "code": "HACKED", "annual_allocation": 3}, format="json"
    )

    assert response.status_code == 201
    assert response.json()["data"]["code"] != "HACKED"


def test_delete_a_type_that_is_referenced_by_a_balance_is_protected():
    client, _ = _hr_client()
    created = client.post(
        URL, {"name": "Sick Leave", "annual_allocation": 10}, format="json"
    ).json()["data"]
    leave_type = LeaveType.objects.get(pk=created["id"])
    employee = EmployeeFactory()
    from leave.models import LeaveBalance

    LeaveBalance.objects.create(employee=employee, leave_type=leave_type, financial_year="2026")

    response = client.delete(f"{URL}/{created['id']}")

    assert response.status_code >= 400
