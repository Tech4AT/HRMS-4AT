"""ORG Wave 1: effective-dated org changes — scoped CRUD plus the command that
applies due rows onto the employee."""

from datetime import date, timedelta

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import Department, Employee, Level, Position
from orgchanges.models import OrgChange

pytestmark = pytest.mark.django_db


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


def _raise(hr, employee, change_type="dept_transfer", to_data=None, effective=None):
    return hr.post(
        "/api/v1/org-changes/",
        {
            "employee_id": employee.pk,
            "change_type": change_type,
            "to_data": to_data or {},
            "effective_date": str(effective or date.today()),
        },
        format="json",
    )


# --- CRUD + scope ---------------------------------------------------------------


def test_hr_raises_a_transfer_and_reads_it_back_snake_case():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    dept = DepartmentFactory(name="New Home")

    created = _raise(hr, employee, to_data={"department_id": dept.pk})

    assert created.status_code == 201
    body = created.json()["data"]
    assert body["employee_id"] == str(employee.pk) and body["status"] == "pending"
    assert body["to_data"] == {"department_id": dept.pk}
    assert AuditLog.objects.filter(action="OrgChange.created").exists()


def test_a_person_sees_only_their_own_changes():
    hr, _ = _hr_client()
    alice = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    bob = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    dept = DepartmentFactory(name="New Home")
    assert _raise(hr, alice, to_data={"department_id": dept.pk}).status_code == 201

    alice_client = APIClient()
    alice_client.force_authenticate(user=alice.user)
    bob_client = APIClient()
    bob_client.force_authenticate(user=bob.user)

    assert len(alice_client.get("/api/v1/org-changes/").json()["data"]) == 1
    assert bob_client.get("/api/v1/org-changes/").json()["data"] == []


def test_due_peek_is_scoped_for_self_tier_holders():
    """orgchanges.read at SELF (every employee) must not reveal the whole org's
    pending changes through the due-changes peek; HR (org.manage) sees them all."""
    hr, _ = _hr_client()
    alice = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    bob = EmployeeFactory(user=UserFactory(role=Role.objects.get(name="Employee")))
    dept = DepartmentFactory(name="New Home")
    assert _raise(hr, alice, to_data={"department_id": dept.pk}).status_code == 201

    bob_client = APIClient()
    bob_client.force_authenticate(user=bob.user)

    assert bob_client.get("/api/v1/org-changes-due/").json()["data"] == []
    assert len(hr.get("/api/v1/org-changes-due/").json()["data"]) == 1


def test_raising_a_change_for_an_unknown_target_is_a_field_error():
    hr, _ = _hr_client()

    response = _raise(hr, EmployeeFactory(), to_data={"department_id": 999999})

    assert response.status_code == 400


def test_a_manager_change_that_would_build_a_cycle_is_rejected():
    hr, _ = _hr_client()
    boss = EmployeeFactory()
    report = EmployeeFactory(manager=boss)

    response = _raise(hr, boss, change_type="manager_change", to_data={"manager_id": report.pk})

    assert response.status_code == 400


def test_effective_rows_are_history_and_effective_is_never_set_by_edit():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    dept = DepartmentFactory(name="New Home")
    pk = _raise(hr, employee, to_data={"department_id": dept.pk}).json()["data"]["id"]

    assert (
        hr.patch(f"/api/v1/org-changes/{pk}/", {"status": "effective"}, format="json").status_code
        == 400
    )
    assert (
        hr.patch(f"/api/v1/org-changes/{pk}/", {"status": "cancelled"}, format="json").status_code
        == 200
    )
    cancelled = hr.patch(
        f"/api/v1/org-changes/{pk}/", {"to_data": {"department_id": dept.pk}}, format="json"
    )
    assert cancelled.status_code == 409


# --- the apply command ------------------------------------------------------------


def test_due_transfer_applies_and_future_rows_stay_pending():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    old_dept = DepartmentFactory(name="Old Home")
    new_dept = DepartmentFactory(name="New Home")
    employee.department = old_dept
    employee.save()
    due_pk = _raise(hr, employee, to_data={"department_id": new_dept.pk}).json()["data"]["id"]
    future_pk = _raise(
        hr,
        employee,
        to_data={"department_id": old_dept.pk},
        effective=date.today() + timedelta(days=30),
    ).json()["data"]["id"]

    call_command("apply_due_org_changes")

    employee.refresh_from_db()
    assert employee.department_id == new_dept.pk
    assert OrgChange.objects.get(pk=due_pk).status == "effective"
    assert OrgChange.objects.get(pk=future_pk).status == "pending"
    assert AuditLog.objects.filter(action="OrgChange.dept_transfer").exists()


def test_dry_run_lists_without_writing():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    new_dept = DepartmentFactory(name="New Home")
    pk = _raise(hr, employee, to_data={"department_id": new_dept.pk}).json()["data"]["id"]

    call_command("apply_due_org_changes", "--dry-run")

    employee.refresh_from_db()
    assert employee.department_id != new_dept.pk
    assert OrgChange.objects.get(pk=pk).status == "pending"


def test_position_change_moves_the_seat_and_vacates_the_old_one():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    old_seat = Position.objects.create(name="Old Seat", status="filled", incumbent=employee)
    employee.position = old_seat
    employee.save()
    new_seat = Position.objects.create(name="New Seat", status="vacant")
    pk = _raise(
        hr, employee, change_type="position_change", to_data={"position_id": new_seat.pk}
    ).json()["data"]["id"]

    call_command("apply_due_org_changes")

    employee.refresh_from_db()
    new_seat.refresh_from_db()
    old_seat.refresh_from_db()
    assert employee.position_id == new_seat.pk
    assert (new_seat.incumbent_id, new_seat.status) == (employee.pk, "filled")
    assert (old_seat.incumbent_id, old_seat.status) == (None, "vacant")
    assert OrgChange.objects.get(pk=pk).status == "effective"


def test_promotion_writes_level_and_grade():
    hr, _ = _hr_client()
    employee = EmployeeFactory()
    level = Level.objects.create(name="T4 · Lead")
    pk = _raise(hr, employee, change_type="promotion", to_data={"level_id": level.pk}).json()[
        "data"
    ]["id"]

    call_command("apply_due_org_changes")

    employee.refresh_from_db()
    assert employee.level_id == level.pk
    assert OrgChange.objects.get(pk=pk).status == "effective"


def test_due_queue_endpoint_lists_only_arrived_rows():
    hr, hr_user = _hr_client()
    employee = EmployeeFactory()
    dept = DepartmentFactory(name="New Home")
    _raise(hr, employee, to_data={"department_id": dept.pk})
    _raise(
        hr, employee, to_data={"department_id": dept.pk}, effective=date.today() + timedelta(days=9)
    )

    body = hr.get("/api/v1/org-changes-due/").json()

    assert body["success"] is True and len(body["data"]) == 1
    assert Employee.objects.filter(pk=employee.pk).exists()
