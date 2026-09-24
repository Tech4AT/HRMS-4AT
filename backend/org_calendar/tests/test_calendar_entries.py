import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

URL = "/api/v1/calendar/entries"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


# ------------------------------- permissions --------------------------------


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_roles_without_calendar_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(URL).status_code == 403
    assert (
        client.post(
            URL, {"type": "holiday", "date": "2026-01-01", "name": "X"}, format="json"
        ).status_code
        == 403
    )


def test_hr_admin_may_list_entries():
    client, _ = _hr_client()

    response = client.get(URL)

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] == []


# ---------------------------------- create -----------------------------------


def test_hr_admin_creates_an_entry():
    client, hr = _hr_client()

    response = client.post(
        URL,
        {
            "type": "holiday",
            "date": "2026-01-26",
            "name": "Republic Day",
            "description": "National holiday",
        },
        format="json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    entry = body["data"]
    assert entry["type"] == "holiday"
    assert entry["date"] == "2026-01-26"
    assert entry["name"] == "Republic Day"
    assert entry["description"] == "National holiday"
    assert entry["id"] and entry["created_at"] and entry["updated_at"]
    assert AuditLog.objects.filter(
        action="CalendarEntry.created", entity_id=str(entry["id"])
    ).exists()


def test_create_without_description_stores_null():
    client, _ = _hr_client()

    response = client.post(
        URL, {"type": "event", "date": "2026-03-01", "name": "Townhall"}, format="json"
    )

    assert response.status_code == 201
    assert response.json()["data"]["description"] is None


def test_create_requires_type_date_and_name():
    client, _ = _hr_client()

    response = client.post(URL, {"type": "holiday", "date": "2026-01-01"}, format="json")

    assert response.status_code == 400


# ---------------------------------- list filters ------------------------------


def test_list_filters_by_from_to_and_type():
    client, _ = _hr_client()
    CalendarEntry.objects.create(type="holiday", date="2026-01-01", name="New Year")
    CalendarEntry.objects.create(type="event", date="2026-02-01", name="Kickoff")
    CalendarEntry.objects.create(type="holiday", date="2026-03-01", name="Late Holiday")

    by_range = client.get(URL, {"from": "2026-01-15", "to": "2026-02-15"}).json()["data"]
    by_type = client.get(URL, {"type": "holiday"}).json()["data"]

    assert [e["name"] for e in by_range] == ["Kickoff"]
    assert {e["name"] for e in by_type} == {"New Year", "Late Holiday"}


# ---------------------------------- update (PUT-as-partial) -------------------


def test_put_updates_only_the_fields_sent():
    client, _ = _hr_client()
    entry = CalendarEntry.objects.create(
        type="event", date="2026-04-01", name="Old Name", description="Old description"
    )

    response = client.put(f"{URL}/{entry.pk}", {"name": "New Name"}, format="json")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "New Name"
    assert data["description"] == "Old description"  # untouched
    assert data["date"] == "2026-04-01"  # untouched
    assert AuditLog.objects.filter(action="CalendarEntry.updated", entity_id=str(entry.pk)).exists()


def test_put_can_clear_description_with_explicit_null():
    client, _ = _hr_client()
    entry = CalendarEntry.objects.create(type="event", date="2026-04-01", name="X", description="Y")

    response = client.put(f"{URL}/{entry.pk}", {"description": None}, format="json")

    assert response.status_code == 200
    assert response.json()["data"]["description"] is None


# ---------------------------------- delete -------------------------------------


def test_delete_returns_success_envelope_with_null_data():
    client, _ = _hr_client()
    entry = CalendarEntry.objects.create(type="holiday", date="2026-05-01", name="X")

    response = client.delete(f"{URL}/{entry.pk}")

    assert response.status_code == 200
    assert response.json() == {"success": True, "data": None}
    assert not CalendarEntry.objects.filter(pk=entry.pk).exists()
    assert AuditLog.objects.filter(action="CalendarEntry.deleted", entity_id=str(entry.pk)).exists()


def test_delete_missing_entry_is_404():
    client, _ = _hr_client()

    assert client.delete(f"{URL}/999999").status_code == 404
