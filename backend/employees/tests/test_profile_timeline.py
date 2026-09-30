"""Employee 360 timeline: `/employees/<id|me>/profile/timeline/`."""

from datetime import date, datetime, timezone

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.service import write_audit
from employees.factories import DepartmentFactory, EmployeeFactory, LegalEntityFactory
from employees.models import Designation, Resignation
from orgchanges.models import OrgChange

pytestmark = pytest.mark.django_db


def _as(role_name, **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name), first_name="Pat", last_name="Lee")
    employee = EmployeeFactory(user=user, **employee_kwargs)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _events(client, target="me"):
    response = client.get(f"/api/v1/employees/{target}/profile/timeline/")
    assert response.status_code == 200, response.content
    return response.json()["data"]["events"]


def _kinds(events):
    return [e["kind"] for e in events]


def test_joining_shows_with_the_company_name_and_a_new_hire_with_nothing_else_has_only_that():
    client, _ = _as(
        "Employee",
        date_of_joining=date(2026, 4, 2),
        legal_entity=LegalEntityFactory(name="4AT Consulting LLP"),
    )

    events = _events(client)

    assert events == [
        {
            "id": "joined",
            "kind": "joined",
            "title": "Joined 4AT Consulting LLP",
            "date": "2026-04-02",
            "detail": None,
            "person": None,
        }
    ]


def test_someone_with_no_history_gets_an_empty_list():
    client, _ = _as("Employee")

    assert _events(client) == []


def test_effective_org_changes_show_with_resolved_names_and_pending_or_cancelled_do_not():
    client, me = _as("Employee", date_of_joining=date(2024, 1, 1))
    old, new = Designation.objects.create(name="Analyst"), Designation.objects.create(name="Senior Analyst")
    dept = DepartmentFactory(name="Finance")
    OrgChange.objects.create(
        employee=me,
        change_type="promotion",
        from_data={"designation_id": old.pk},
        to_data={"designation_id": new.pk},
        effective_date=date(2025, 6, 1),
        status="effective",
    )
    OrgChange.objects.create(
        employee=me,
        change_type="dept_transfer",
        to_data={"department_id": dept.pk},
        effective_date=date(2025, 9, 1),
        status="effective",
    )
    OrgChange.objects.create(
        employee=me, change_type="promotion", to_data={"designation_id": new.pk},
        effective_date=date(2026, 1, 1), status="pending",
    )
    OrgChange.objects.create(
        employee=me, change_type="promotion", to_data={"designation_id": new.pk},
        effective_date=date(2026, 2, 1), status="cancelled",
    )

    events = _events(client)

    assert _kinds(events) == ["dept_transfer", "promotion", "joined"]  # newest first
    promotion = next(e for e in events if e["kind"] == "promotion")
    assert promotion["title"] == "Promoted" and promotion["detail"] == "Analyst → Senior Analyst"
    assert next(e for e in events if e["kind"] == "dept_transfer")["detail"] == "Finance"


def test_a_report_added_by_an_org_change_shows_who():
    client, me = _as("Employee")
    report = EmployeeFactory(user=UserFactory(first_name="Shashank", last_name="Bala"))
    OrgChange.objects.create(
        employee=report,
        change_type="manager_change",
        to_data={"manager_id": str(me.pk)},
        effective_date=date(2026, 4, 23),
        status="effective",
    )

    events = _events(client)

    assert len(events) == 1
    assert events[0]["kind"] == "direct_report_added"
    assert events[0]["title"] == "Added direct report" and events[0]["date"] == "2026-04-23"
    assert events[0]["person"] == {"id": str(report.pk), "name": "Shashank Bala"}


def test_a_report_created_or_moved_under_them_shows_from_the_audit_trail_without_duplicates():
    client, me = _as("Employee")
    created = EmployeeFactory(user=UserFactory(first_name="New", last_name="Hire"))
    moved = EmployeeFactory(user=UserFactory(first_name="Mo", last_name="Ved"))
    already = EmployeeFactory(user=UserFactory(first_name="Al", last_name="Ready"))
    write_audit(None, "Employee.created", "Employee", created.pk, {"after": {"manager_id": str(me.pk)}})
    write_audit(
        None, "Employee.updated", "Employee", moved.pk,
        {"before": {"manager_id": None}, "after": {"manager_id": str(me.pk)}},
    )
    # An edit to someone who already reported to them is not "added".
    write_audit(
        None, "Employee.updated", "Employee", already.pk,
        {"before": {"manager_id": str(me.pk)}, "after": {"manager_id": str(me.pk)}},
    )

    names = sorted(e["person"]["name"] for e in _events(client))

    assert names == ["Mo Ved", "New Hire"]


def test_leaving_shows_for_anyone_who_can_open_the_profile():
    manager_client, manager = _as("Manager")
    gone = EmployeeFactory(manager=manager, status="exited", date_of_exit=date(2026, 8, 1))

    events = _events(manager_client, gone.pk)

    assert _kinds(events) == ["left"]


def test_resignation_steps_show_for_the_person_and_hr_but_not_for_a_manager():
    client, me = _as("Employee")
    hr, _ = _as("HR Admin")
    manager_client, manager = _as("Manager")
    me.manager = manager
    me.save()
    accepted = Resignation.objects.create(
        employee=me,
        reason="Moving",
        requested_last_day=date(2026, 9, 30),
        last_working_day=date(2026, 9, 25),
        status="accepted",
        decided_at=datetime(2026, 9, 10, tzinfo=timezone.utc),
    )

    mine = _kinds(_events(client))
    hr_view = _kinds(_events(hr, me.pk))
    manager_view = _kinds(_events(manager_client, me.pk))

    assert {"resignation_submitted", "resignation_accepted"} <= set(mine)
    assert {"resignation_submitted", "resignation_accepted"} <= set(hr_view)
    assert not {k for k in manager_view if k.startswith("resignation")}
    detail = next(e for e in _events(client) if e["kind"] == "resignation_accepted")["detail"]
    assert detail == "Last working day: 2026-09-25" and accepted.pk


def test_the_timeline_follows_profile_access():
    client, _ = _as("Employee")
    other = EmployeeFactory()

    assert client.get(f"/api/v1/employees/{other.pk}/profile/timeline/").status_code == 403
    assert client.get("/api/v1/employees/999999/profile/timeline/").status_code == 404
    assert APIClient().get("/api/v1/employees/me/profile/timeline/").status_code == 401


def test_events_are_newest_first_across_kinds():
    client, me = _as("Employee", date_of_joining=date(2020, 1, 1))
    OrgChange.objects.create(
        employee=me, change_type="location_transfer", to_data={},
        effective_date=date(2023, 3, 3), status="effective",
    )
    me.date_of_exit = date(2026, 1, 1)
    me.save()

    dates = [e["date"] for e in _events(client)]

    assert dates == sorted(dates, reverse=True) == ["2026-01-01", "2023-03-03", "2020-01-01"]
