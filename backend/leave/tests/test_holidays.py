import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from org_calendar.factories import make_calendar
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

URL = "/api/v1/leave/holidays"


def _client():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


def test_returns_the_employees_holidays_in_the_holiday_contract():
    client, employee = _client()
    calendar = make_calendar(employee)
    CalendarEntry.objects.create(
        calendar=calendar,
        type="holiday",
        date="2026-01-26",
        name="Republic Day",
        description="National holiday",
        special=True,
    )
    CalendarEntry.objects.create(
        calendar=calendar, type="event", date="2026-01-26", name="Not a holiday"
    )

    response = client.get(URL, {"year": "2026"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["name"] == "Republic Day"
    assert data[0]["holiday_date"] == "2026-01-26"
    assert data[0]["is_optional"] is False
    assert data[0]["is_special"] is True
    assert data[0]["description"] == "National holiday"


def test_optional_holidays_are_flagged_optional():
    client, employee = _client()
    CalendarEntry.objects.create(
        calendar=make_calendar(employee),
        type="holiday",
        date="2026-03-04",
        name="Holi",
        optional=True,
    )

    data = client.get(URL, {"year": "2026"}).json()["data"]

    assert [(h["name"], h["is_optional"]) for h in data] == [("Holi", True)]


def test_holidays_from_every_calendar_the_employee_follows_are_listed():
    client, employee = _client()
    first = make_calendar(employee, name="HQ")
    second = make_calendar(employee, name="Support team")
    CalendarEntry.objects.create(
        calendar=first, type="holiday", date="2026-01-26", name="Republic Day"
    )
    CalendarEntry.objects.create(
        calendar=second, type="holiday", date="2026-02-14", name="Team day"
    )
    CalendarEntry.objects.create(
        calendar=second, type="holiday", date="2026-01-26", name="republic day"
    )

    data = client.get(URL, {"year": "2026"}).json()["data"]

    # The same holiday on two calendars is listed once.
    assert [h["holiday_date"] for h in data] == ["2026-01-26", "2026-02-14"]


def test_another_calendars_holidays_are_not_shown():
    client, _ = _client()
    someone_else = EmployeeFactory()
    CalendarEntry.objects.create(
        calendar=make_calendar(someone_else), type="holiday", date="2026-01-26", name="Not mine"
    )

    assert client.get(URL, {"year": "2026"}).json()["data"] == []


def test_an_employee_with_no_calendar_gets_no_holidays():
    client, _ = _client()

    assert client.get(URL, {"year": "2026"}).json()["data"] == []


def test_a_department_calendar_reaches_its_members():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    from employees.factories import DepartmentFactory

    department = DepartmentFactory()
    EmployeeFactory(user=user, department=department)
    client = APIClient()
    client.force_authenticate(user=user)
    CalendarEntry.objects.create(
        calendar=make_calendar(departments=[department]),
        type="holiday",
        date="2026-05-01",
        name="May Day",
    )

    data = client.get(URL, {"year": "2026"}).json()["data"]

    assert [h["name"] for h in data] == ["May Day"]


def test_a_non_numeric_year_is_a_400_not_a_500():
    """Found during a comprehensive audit: `int(year_param)` was unguarded,
    so a malformed year crashed with an unhandled 500 instead of a
    validation error."""
    client, _ = _client()

    response = client.get(URL, {"year": "abc"})

    assert response.status_code == 400


def test_defaults_to_the_current_year_when_year_is_omitted():
    from django.utils import timezone

    client, employee = _client()
    today = timezone.localdate()
    CalendarEntry.objects.create(
        calendar=make_calendar(employee), type="holiday", date=today, name="Today's Holiday"
    )

    response = client.get(URL)

    assert any(h["name"] == "Today's Holiday" for h in response.json()["data"])
