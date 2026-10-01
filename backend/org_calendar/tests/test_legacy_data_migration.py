"""0005 moves the previous organisation-wide calendar rows into one ordinary
calendar called "General", assigned explicitly (all active departments plus
department-less employees), so existing people keep their holidays and weekly
offs. Drives the real migration graph for this app: back to 0004 (calendar
columns exist but are still empty), build old-shape data, forward again."""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from employees.factories import DepartmentFactory, EmployeeFactory

BEFORE = ("org_calendar", "0004_calendar_schema")
AFTER_DATA = ("org_calendar", "0005_move_existing_data_into_a_calendar")

pytestmark = pytest.mark.django_db(transaction=True)


def _migrate(target):
    executor = MigrationExecutor(connection)
    executor.migrate([target])
    return MigrationExecutor(connection).loader.project_state([target]).apps


def _latest():
    graph = MigrationExecutor(connection).loader.graph
    return ("org_calendar", dict(graph.leaf_nodes())["org_calendar"])


@pytest.fixture(autouse=True)
def _back_to_latest_afterwards():
    yield
    _migrate(_latest())


def test_existing_rows_land_in_a_general_calendar_assigned_to_current_staff():
    old = _migrate(BEFORE)
    WeekOff = old.get_model("org_calendar", "WeekOff")
    Entry = old.get_model("org_calendar", "CalendarEntry")
    Rule = old.get_model("org_calendar", "RecurringWfhRule")
    # Start from a clean slate: the fresh-install migration run already created a
    # "General" calendar from the seeded Sat/Sun rows.
    old.get_model("org_calendar", "Calendar").objects.all().delete()
    WeekOff.objects.all().delete()
    WeekOff.objects.create(weekday=6, active=True)
    WeekOff.objects.create(weekday=0, active=False)  # "working day" in the old model
    Entry.objects.create(type="holiday", date="2026-01-26", name="Republic Day")
    Rule.objects.create(weekday=3, label="Every Wednesday")

    department = DepartmentFactory()
    retired = DepartmentFactory(is_active=False)
    member = EmployeeFactory(department=department)
    no_department = EmployeeFactory(department=None)

    new = _migrate(AFTER_DATA)
    Calendar = new.get_model("org_calendar", "Calendar")
    calendar = Calendar.objects.get()

    assert calendar.name == "General"
    assert list(calendar.departments.values_list("pk", flat=True)) == [department.pk]
    assert retired.pk not in calendar.departments.values_list("pk", flat=True)
    assert list(calendar.employees.values_list("pk", flat=True)) == [no_department.pk]
    assert new.get_model("org_calendar", "CalendarEntry").objects.get().calendar_id == calendar.pk
    assert (
        new.get_model("org_calendar", "RecurringWfhRule").objects.get().calendar_id == calendar.pk
    )
    weekoffs = new.get_model("org_calendar", "WeekOff").objects.all()
    assert [w.weekday for w in weekoffs] == [6]  # the inactive Sunday row is gone
    assert weekoffs[0].calendar_id == calendar.pk
    assert member.department_id == department.pk


def test_the_moved_calendar_gives_current_staff_their_old_behaviour():
    from datetime import date

    from attendance.day_facts import get_day_facts

    old = _migrate(BEFORE)
    old.get_model("org_calendar", "Calendar").objects.all().delete()
    old.get_model("org_calendar", "WeekOff").objects.all().delete()
    old.get_model("org_calendar", "WeekOff").objects.create(weekday=6, active=True)
    old.get_model("org_calendar", "CalendarEntry").objects.create(
        type="holiday", date="2026-01-26", name="Republic Day"
    )
    department = DepartmentFactory()
    member = EmployeeFactory(department=department)
    stranger = EmployeeFactory(department=None)

    _migrate(_latest())

    for employee in (member, stranger):
        facts = get_day_facts(date(2026, 1, 26), employee=employee)
        assert facts.is_holiday and facts.holiday_name == "Republic Day"
        assert get_day_facts(date(2026, 1, 31), employee=employee).is_weekend  # Saturday


def test_nothing_is_created_when_there_is_no_legacy_data():
    old = _migrate(BEFORE)
    old.get_model("org_calendar", "Calendar").objects.all().delete()
    old.get_model("org_calendar", "WeekOff").objects.all().delete()

    new = _migrate(AFTER_DATA)

    assert new.get_model("org_calendar", "Calendar").objects.count() == 0
