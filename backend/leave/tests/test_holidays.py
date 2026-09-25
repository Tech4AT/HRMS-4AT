import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/holidays"


def _client():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


def test_reshapes_calendar_entries_into_the_holiday_contract():
    CalendarEntry.objects.create(
        type="holiday", date="2026-01-26", name="Republic Day", description="National holiday"
    )
    CalendarEntry.objects.create(type="event", date="2026-01-26", name="Not a holiday")
    client = _client()

    response = client.get(URL, {"year": "2026"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["name"] == "Republic Day"
    assert data[0]["holiday_date"] == "2026-01-26"
    assert data[0]["is_optional"] is False
    assert data[0]["description"] == "National holiday"


def test_defaults_to_the_current_year_when_year_is_omitted():
    from django.utils import timezone

    today = timezone.localdate()
    CalendarEntry.objects.create(type="holiday", date=today, name="Today's Holiday")
    client = _client()

    response = client.get(URL)

    assert any(h["name"] == "Today's Holiday" for h in response.json()["data"])
