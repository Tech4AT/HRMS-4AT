import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from org_calendar.models import WeekOff

pytestmark = pytest.mark.django_db

URL = "/api/v1/calendar/week-off"


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


@pytest.mark.parametrize("role", ["Employee", "Manager"])
def test_roles_without_calendar_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(URL).status_code == 403
    assert client.post(URL, {"weekday": 5}, format="json").status_code == 403


def test_default_seed_is_saturday_and_sunday():
    client, _ = _hr_client()

    response = client.get(URL)

    assert response.status_code == 200
    weekdays = {row["weekday"] for row in response.json()["data"]}
    assert weekdays == {0, 6}  # Sunday, Saturday
    assert all(row["active"] for row in response.json()["data"])


def test_hr_admin_can_reconfigure_which_weekdays_are_off():
    client, _ = _hr_client()
    sunday = WeekOff.objects.get(weekday=0)

    response = client.patch(f"{URL}/{sunday.pk}", {"active": False}, format="json")

    assert response.status_code == 200
    assert response.json()["data"]["active"] is False
    assert AuditLog.objects.filter(action="WeekOff.updated", entity_id=str(sunday.pk)).exists()


def test_create_a_new_weekday_as_off():
    client, _ = _hr_client()

    response = client.post(URL, {"weekday": 5}, format="json")  # Friday

    assert response.status_code == 201
    assert response.json()["data"]["weekday"] == 5


def test_weekday_out_of_range_is_rejected():
    client, _ = _hr_client()

    assert client.post(URL, {"weekday": 7}, format="json").status_code == 400


def test_weekday_must_be_unique():
    client, _ = _hr_client()

    response = client.post(URL, {"weekday": 6}, format="json")  # Saturday, already seeded

    assert response.status_code == 400
