import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import Shift
from audit.models import AuditLog
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/attendance/shifts"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_roles_without_attendance_settings_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(URL).status_code == 403
    assert (
        client.post(
            URL, {"name": "X", "startTime": "09:00", "endTime": "18:00"}, format="json"
        ).status_code
        == 403
    )


def test_hr_admin_creates_a_shift_with_camelcase_fields():
    client, _ = _hr_client()

    response = client.post(
        URL,
        {"name": "General Shift", "startTime": "09:30", "endTime": "18:30", "breakMinutes": 60},
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["name"] == "General Shift"
    assert data["startTime"] == "09:30"
    assert data["endTime"] == "18:30"
    assert data["breakMinutes"] == 60
    assert data["employeeIds"] == []
    assert AuditLog.objects.filter(action="Shift.created", entity_id=str(data["id"])).exists()


def test_overnight_shift_is_stored_as_is_no_special_handling():
    client, _ = _hr_client()

    response = client.post(
        URL, {"name": "Night Shift", "startTime": "22:00", "endTime": "06:00"}, format="json"
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["startTime"] == "22:00"
    assert data["endTime"] == "06:00"


def test_assign_employees_replaces_the_whole_list():
    client, _ = _hr_client()
    emp_a = EmployeeFactory()
    emp_b = EmployeeFactory()
    created = client.post(
        URL,
        {
            "name": "General Shift",
            "startTime": "09:00",
            "endTime": "18:00",
            "employeeIds": [str(emp_a.pk)],
        },
        format="json",
    ).json()["data"]
    assert created["employeeIds"] == [str(emp_a.pk)]

    response = client.put(
        f"{URL}/{created['id']}",
        {
            "name": "General Shift",
            "startTime": "09:00",
            "endTime": "18:00",
            "breakMinutes": 30,
            "employeeIds": [str(emp_b.pk)],
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["data"]["employeeIds"] == [str(emp_b.pk)]


def test_list_and_delete():
    client, _ = _hr_client()
    shift = Shift.objects.create(name="Morning Shift", start_time="06:00", end_time="14:00")

    listed = client.get(URL)
    assert listed.status_code == 200
    assert len(listed.json()["data"]) == 1

    deleted = client.delete(f"{URL}/{shift.pk}")
    assert deleted.status_code == 200
    assert deleted.json() == {"success": True, "data": None}
    assert not Shift.objects.filter(pk=shift.pk).exists()
    assert AuditLog.objects.filter(action="Shift.deleted", entity_id=str(shift.pk)).exists()
