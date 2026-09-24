import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from org_calendar.models import RecurringWfhRule

pytestmark = pytest.mark.django_db

URL = "/api/v1/calendar/recurring-wfh"


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
    assert client.post(URL, {"weekday": 3}, format="json").status_code == 403


def test_create_without_label_defaults_to_every_weekday():
    client, _ = _hr_client()

    response = client.post(URL, {"weekday": 3}, format="json")

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["label"] == "Every Wednesday"
    assert data["active"] is True
    assert AuditLog.objects.filter(
        action="RecurringWfhRule.created", entity_id=str(data["id"])
    ).exists()


def test_create_with_explicit_label():
    client, _ = _hr_client()

    response = client.post(URL, {"weekday": 5, "label": "Half day Fridays"}, format="json")

    assert response.status_code == 201
    assert response.json()["data"]["label"] == "Half day Fridays"


def test_patch_toggles_active_only():
    client, _ = _hr_client()
    rule = RecurringWfhRule.objects.create(weekday=2, label="Every Tuesday", active=True)

    response = client.patch(f"{URL}/{rule.pk}", {"active": False}, format="json")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["active"] is False
    assert data["weekday"] == 2
    assert data["label"] == "Every Tuesday"
    assert AuditLog.objects.filter(
        action="RecurringWfhRule.updated", entity_id=str(rule.pk)
    ).exists()


def test_delete_returns_success_envelope_with_null_data():
    client, _ = _hr_client()
    rule = RecurringWfhRule.objects.create(weekday=1, label="Every Monday")

    response = client.delete(f"{URL}/{rule.pk}")

    assert response.status_code == 200
    assert response.json() == {"success": True, "data": None}
    assert not RecurringWfhRule.objects.filter(pk=rule.pk).exists()
    assert AuditLog.objects.filter(
        action="RecurringWfhRule.deleted", entity_id=str(rule.pk)
    ).exists()


def test_weekday_out_of_range_is_rejected():
    client, _ = _hr_client()

    response = client.post(URL, {"weekday": 7}, format="json")

    assert response.status_code == 400
