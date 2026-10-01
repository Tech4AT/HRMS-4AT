from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

URL = "/api/v1/calendar/my-events"


def _employee_client(role="Employee"):
    user = UserFactory(role=Role.objects.get(name=role))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _event(calendar, offset_days, name):
    day = timezone.localdate() + timedelta(days=offset_days)
    return CalendarEntry.objects.create(calendar=calendar, type="event", date=day, name=name)


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


def test_an_ordinary_employee_sees_their_own_upcoming_events():
    client, employee = _employee_client()
    calendar = make_calendar(employee)
    _event(calendar, 3, "Townhall")
    _event(calendar, 90, "Too far away")
    _event(calendar, -2, "Already happened")
    CalendarEntry.objects.create(
        calendar=calendar, type="holiday", date=timezone.localdate() + timedelta(days=4), name="H"
    )

    data = client.get(URL).json()["data"]

    assert [e["name"] for e in data] == ["Townhall"]


def test_events_from_every_calendar_are_merged_and_deduplicated():
    client, employee = _employee_client()
    first, second = make_calendar(employee, name="A"), make_calendar(employee, name="B")
    _event(first, 2, "Offsite")
    _event(second, 2, "offsite")
    _event(second, 5, "Training")

    data = client.get(URL).json()["data"]

    assert [e["name"] for e in data] == ["Offsite", "Training"]


def test_other_calendars_events_are_not_shown():
    client, _ = _employee_client()
    _event(make_calendar(EmployeeFactory()), 2, "Not mine")

    assert client.get(URL).json()["data"] == []


def test_an_account_without_an_employee_record_gets_an_empty_list():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.get(URL).json()["data"] == []


def test_an_explicit_window_is_honoured_and_a_bad_one_refused():
    client, employee = _employee_client()
    _event(make_calendar(employee), 100, "Far")
    start = timezone.localdate() + timedelta(days=95)
    end = start + timedelta(days=10)

    far = client.get(URL, {"from": start.isoformat(), "to": end.isoformat()}).json()["data"]

    assert [e["name"] for e in far] == ["Far"]
    assert client.get(URL, {"from": end.isoformat(), "to": start.isoformat()}).status_code == 400
    assert client.get(URL, {"from": "2026-01-01", "to": "2028-01-01"}).status_code == 400
