import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from core.enums import EmployeeStatus
from employees.factories import DepartmentFactory, EmployeeFactory
from org_calendar.factories import make_calendar
from org_calendar.models import Calendar, CalendarEntry, RecurringWfhRule, WeekOff

pytestmark = pytest.mark.django_db

URL = "/api/v1/calendar/calendars"


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
def test_roles_without_calendar_manage_are_refused_everywhere(role):
    client, _ = _client(role)
    calendar = make_calendar()

    assert client.get(URL).status_code == 403
    assert client.get(f"{URL}/{calendar.pk}").status_code == 403
    assert client.post(URL, {"name": "X"}, format="json").status_code == 403
    assert client.patch(f"{URL}/{calendar.pk}", {"name": "Y"}, format="json").status_code == 403
    assert client.delete(f"{URL}/{calendar.pk}").status_code == 403
    assert client.get(f"{URL}/coverage").status_code == 403
    assert Calendar.objects.get(pk=calendar.pk).name == calendar.name


# ------------------------------- create / read ------------------------------


def test_create_a_calendar_with_week_offs_departments_and_employees():
    client, _ = _hr_client()
    department = DepartmentFactory()
    person = EmployeeFactory()

    response = client.post(
        URL,
        {
            "name": "Hyderabad office",
            "description": "HQ",
            "department_ids": [department.pk],
            "employee_ids": [person.pk],
            "week_offs": [{"weekday": 0}, {"weekday": 6, "weeks": [4, 2]}],
        },
        format="json",
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["name"] == "Hyderabad office"
    assert isinstance(data["id"], str)
    assert data["department_ids"] == [str(department.pk)]
    assert data["employee_ids"] == [str(person.pk)]
    assert sorted(data["week_offs"], key=lambda r: r["weekday"]) == [
        {"weekday": 0, "weeks": []},
        {"weekday": 6, "weeks": [2, 4]},  # normalised to ascending order
    ]
    assert AuditLog.objects.filter(action="Calendar.created", entity_id=data["id"]).exists()


def test_a_new_calendar_applies_to_nobody_unless_assigned():
    client, _ = _hr_client()

    data = client.post(URL, {"name": "Empty"}, format="json").json()["data"]

    assert data["department_ids"] == [] and data["employee_ids"] == []
    assert data["week_offs"] == [] and data["employee_count"] == 0


def test_list_and_retrieve():
    client, _ = _hr_client()
    calendar = make_calendar(name="Zzz listed")

    listed = client.get(URL).json()["data"]
    one = client.get(f"{URL}/{calendar.pk}").json()["data"]

    assert any(c["id"] == str(calendar.pk) for c in listed)
    assert one["name"] == "Zzz listed"
    assert {r["weekday"] for r in one["week_offs"]} == {0, 6}


def test_employee_count_counts_each_person_once_and_skips_exited():
    client, _ = _hr_client()
    department = DepartmentFactory()
    in_department = EmployeeFactory(department=department)
    both = EmployeeFactory(department=department)
    direct = EmployeeFactory()
    EmployeeFactory(department=department, status=EmployeeStatus.EXITED)
    calendar = make_calendar(both, direct, departments=[department])

    data = client.get(f"{URL}/{calendar.pk}").json()["data"]

    assert data["employee_count"] == 3  # in_department, both, direct
    assert in_department  # silence unused


# ------------------------------- validation ---------------------------------


def test_name_is_required_and_unique_ignoring_case():
    client, _ = _hr_client()
    make_calendar(name="Support")

    assert client.post(URL, {}, format="json").status_code == 400
    assert client.post(URL, {"name": "   "}, format="json").status_code == 400
    assert client.post(URL, {"name": "support"}, format="json").status_code == 400


@pytest.mark.parametrize(
    "week_offs",
    [
        [{"weekday": 7}],
        [{"weekday": -1}],
        [{"weekday": 1, "weeks": [0]}],
        [{"weekday": 1, "weeks": [6]}],
        [{"weekday": 1, "weeks": [2, 2]}],
        [{"weekday": 1}, {"weekday": 1, "weeks": [2]}],
    ],
)
def test_invalid_week_offs_are_rejected(week_offs):
    client, _ = _hr_client()

    response = client.post(URL, {"name": "Bad", "week_offs": week_offs}, format="json")

    assert response.status_code == 400
    assert not Calendar.objects.filter(name="Bad").exists()


def test_unknown_department_or_employee_is_rejected():
    client, _ = _hr_client()

    assert (
        client.post(URL, {"name": "A", "department_ids": [999999]}, format="json").status_code
        == 400
    )
    assert (
        client.post(URL, {"name": "B", "employee_ids": [999999]}, format="json").status_code == 400
    )


# ------------------------------- update -------------------------------------


def test_patch_replaces_assignments_and_week_offs_when_sent():
    client, _ = _hr_client()
    old, new = EmployeeFactory(), EmployeeFactory()
    calendar = make_calendar(old)

    response = client.patch(
        f"{URL}/{calendar.pk}",
        {"employee_ids": [new.pk], "week_offs": [{"weekday": 5}]},
        format="json",
    )

    assert response.status_code == 200
    assert list(calendar.employees.values_list("pk", flat=True)) == [new.pk]
    assert list(calendar.week_offs.values_list("weekday", flat=True)) == [5]
    assert AuditLog.objects.filter(action="Calendar.updated", entity_id=str(calendar.pk)).exists()


def test_patch_leaves_untouched_what_it_does_not_send():
    client, _ = _hr_client()
    person = EmployeeFactory()
    calendar = make_calendar(person)

    client.patch(f"{URL}/{calendar.pk}", {"name": "Renamed"}, format="json")

    calendar.refresh_from_db()
    assert calendar.name == "Renamed"
    assert list(calendar.employees.all()) == [person]
    assert calendar.week_offs.count() == 2


def test_an_empty_list_clears_the_assignment():
    client, _ = _hr_client()
    calendar = make_calendar(EmployeeFactory(), departments=[DepartmentFactory()])

    client.patch(f"{URL}/{calendar.pk}", {"employee_ids": [], "department_ids": []}, format="json")

    assert calendar.employees.count() == 0 and calendar.departments.count() == 0


def test_renaming_to_its_own_name_is_allowed():
    client, _ = _hr_client()
    calendar = make_calendar(name="Same")

    response = client.patch(f"{URL}/{calendar.pk}", {"name": "Same"}, format="json")

    assert response.status_code == 200


# ------------------------------- delete -------------------------------------


def test_deleting_a_calendar_removes_its_dates_week_offs_and_rules_only():
    client, _ = _hr_client()
    doomed, kept = make_calendar(), make_calendar()
    CalendarEntry.objects.create(calendar=doomed, type="holiday", date="2026-01-01", name="A")
    CalendarEntry.objects.create(calendar=kept, type="holiday", date="2026-01-01", name="B")
    RecurringWfhRule.objects.create(calendar=doomed, weekday=1)

    response = client.delete(f"{URL}/{doomed.pk}")

    assert response.status_code == 200
    assert response.json() == {"success": True, "data": None}
    assert not CalendarEntry.objects.filter(calendar_id=doomed.pk).exists()
    assert not RecurringWfhRule.objects.filter(calendar_id=doomed.pk).exists()
    assert not WeekOff.objects.filter(calendar_id=doomed.pk).exists()
    assert CalendarEntry.objects.filter(calendar=kept).count() == 1
    assert WeekOff.objects.filter(calendar=kept).count() == 2
    assert AuditLog.objects.filter(action="Calendar.deleted", entity_id=str(doomed.pk)).exists()


def test_deleting_a_calendar_does_not_delete_the_people_or_departments_on_it():
    client, _ = _hr_client()
    person = EmployeeFactory()
    department = DepartmentFactory()
    calendar = make_calendar(person, departments=[department])

    client.delete(f"{URL}/{calendar.pk}")

    person.refresh_from_db()
    department.refresh_from_db()


def test_delete_missing_calendar_is_404():
    client, _ = _hr_client()

    assert client.delete(f"{URL}/999999").status_code == 404


# ------------------------------- coverage -----------------------------------


def test_coverage_lists_active_employees_that_no_calendar_covers():
    client, _ = _hr_client()
    department = DepartmentFactory()
    covered_direct = EmployeeFactory()
    covered_by_department = EmployeeFactory(department=department)
    uncovered = EmployeeFactory(department=DepartmentFactory())
    EmployeeFactory(status=EmployeeStatus.EXITED)  # exited people are not "unassigned"
    make_calendar(covered_direct, departments=[department])

    data = client.get(f"{URL}/coverage").json()["data"]

    ids = {row["id"] for row in data["unassigned"]}
    assert str(uncovered.pk) in ids
    assert str(covered_direct.pk) not in ids
    assert str(covered_by_department.pk) not in ids
    assert data["unassigned_count"] == len(data["unassigned"])
    assert data["active_employees"] >= data["unassigned_count"]


# ------------------------------- end to end ---------------------------------


def test_assigning_a_calendar_through_the_api_changes_that_employees_day_facts():
    from datetime import date

    from attendance.day_facts import get_day_facts

    client, _ = _hr_client()
    employee = EmployeeFactory()
    saturday = date(2026, 1, 31)
    assert get_day_facts(saturday, employee=employee).is_weekend is False

    created = client.post(
        URL,
        {"name": "Weekend", "employee_ids": [employee.pk], "week_offs": [{"weekday": 6}]},
        format="json",
    ).json()["data"]

    assert get_day_facts(saturday, employee=employee).is_weekend is True

    client.patch(f"{URL}/{created['id']}", {"employee_ids": []}, format="json")

    assert get_day_facts(saturday, employee=employee).is_weekend is False
