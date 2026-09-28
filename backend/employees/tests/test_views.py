"""API-level 200/403 matrix for the employee directory, across all 4 starter
roles — docs/TASKS.md build-sequence step 8. Uses the same seed data shape as
accounts/migrations/0002_seed_starter_roles (rebuilt via factories here so
tests don't depend on migration state)."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from core.enums import ScopeTier
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def employees_read_permission():
    return PermissionFactory(code="employees.read")


@pytest.fixture
def starter_roles(employees_read_permission):
    # Deliberately named differently from the real seeded starter roles
    # (accounts/migrations/0002_seed_starter_roles, which pytest-django's test
    # DB also carries) — reusing "Employee"/"Manager"/etc. here would collide
    # with that migration's own RolePermission rows on the unique constraint.
    employee_role = RoleFactory(name="Test Employee")
    manager_role = RoleFactory(name="Test Manager")
    hr_admin_role = RoleFactory(name="Test HR Admin")
    finance_role = RoleFactory(name="Test Finance")

    RolePermissionFactory(
        role=employee_role, permission=employees_read_permission, scope_tier=ScopeTier.SELF
    )
    RolePermissionFactory(
        role=manager_role, permission=employees_read_permission, scope_tier=ScopeTier.MANAGER
    )
    RolePermissionFactory(
        role=hr_admin_role, permission=employees_read_permission, scope_tier=ScopeTier.ALL
    )
    RolePermissionFactory(
        role=finance_role, permission=employees_read_permission, scope_tier=ScopeTier.ALL
    )
    return {
        "Employee": employee_role,
        "Manager": manager_role,
        "HR Admin": hr_admin_role,
        "Finance": finance_role,
    }


@pytest.fixture
def logged_in_client():
    def _make(role):
        user = UserFactory(role=role)
        EmployeeFactory(user=user)
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    return _make


def test_unauthenticated_request_is_401(starter_roles):
    client = APIClient()
    resp = client.get("/api/v1/employees/")
    assert resp.status_code == 401


@pytest.mark.parametrize("role_name", ["Employee", "Manager", "HR Admin", "Finance"])
def test_every_starter_role_can_list_employees(starter_roles, logged_in_client, role_name):
    # employees.read is granted to all 4 starter roles (just at different
    # scope tiers) — every one of them should get a 200, never a 403, on the
    # directory list itself.
    client = logged_in_client(starter_roles[role_name])
    resp = client.get("/api/v1/employees/")
    assert resp.status_code == 200


def test_employee_role_only_sees_self_in_directory(starter_roles, logged_in_client):
    client = logged_in_client(starter_roles["Employee"])
    other = EmployeeFactory()

    resp = client.get("/api/v1/employees/")

    codes = {e["employee_code"] for e in resp.json()["data"]}
    assert other.employee_code not in codes


def test_hr_admin_sees_everyone_in_directory(starter_roles, logged_in_client):
    client = logged_in_client(starter_roles["HR Admin"])
    EmployeeFactory()
    EmployeeFactory()

    resp = client.get("/api/v1/employees/")

    assert len(resp.json()["data"]) >= 3  # the 2 created here + the caller's own


def test_manager_retrieve_on_stranger_is_403_not_404(starter_roles, logged_in_client):
    client = logged_in_client(starter_roles["Manager"])
    stranger = EmployeeFactory()

    resp = client.get(f"/api/v1/employees/{stranger.pk}/")

    assert resp.status_code == 403


@pytest.mark.parametrize("role_name", ["Employee", "Manager", "Finance"])
def test_non_admin_roles_cannot_reach_role_management(starter_roles, logged_in_client, role_name):
    client = logged_in_client(starter_roles[role_name])

    resp = client.get("/api/v1/roles/")

    assert resp.status_code == 403


def test_hr_admin_can_reach_role_management(starter_roles, logged_in_client):
    role = starter_roles["HR Admin"]
    manage_permission = PermissionFactory(code="roles.manage")
    RolePermissionFactory(role=role, permission=manage_permission, scope_tier=ScopeTier.ALL)
    client = logged_in_client(role)

    resp = client.get("/api/v1/roles/")

    assert resp.status_code == 200


def test_response_shape_matches_frontend_contract(starter_roles, logged_in_client):
    """employees/page.tsx's fetchJson() reads {success, data: Employee[]}
    with snake_case fields — verified against that source, not the general
    camelCase/paginated convention used elsewhere (see
    employees/views.py::FrontendEnvelopeMixin)."""
    employee = EmployeeFactory(
        user__first_name="Ada", user__last_name="Lovelace", user__email="ada@example.com"
    )
    client = logged_in_client(starter_roles["HR Admin"])

    resp = client.get("/api/v1/employees/")

    body = resp.json()
    assert set(body.keys()) == {"success", "data"}
    assert body["success"] is True
    assert isinstance(body["data"], list)
    row = next(e for e in body["data"] if e["id"] == str(employee.pk))
    assert row["first_name"] == "Ada"
    assert row["last_name"] == "Lovelace"
    assert row["work_email"] == "ada@example.com"
    # The fields the frontend pages read must all be present and unchanged. New
    # org and lifecycle fields are additive, and personal details are never here.
    frontend_fields = {
        "id",
        "employee_code",
        "first_name",
        "last_name",
        "work_email",
        "department_id",
        "designation_id",
        "location_id",
        "manager_id",
        "status",
    }
    additive_fields = {
        "legal_entity_id",
        "business_unit_id",
        "cost_center_id",
        "position_id",
        "level_id",
        "grade_id",
        "employment_type",
        "date_of_joining",
        "date_of_exit",
    }
    assert set(row.keys()) == frontend_fields | additive_fields


def test_retrieve_response_shape_matches_frontend_contract(starter_roles, logged_in_client):
    client = logged_in_client(starter_roles["HR Admin"])
    employee = EmployeeFactory()

    resp = client.get(f"/api/v1/employees/{employee.pk}/")

    body = resp.json()
    assert set(body.keys()) == {"success", "data"}
    assert body["data"]["id"] == str(employee.pk)


def test_department_list_is_flat_named_entity_array(starter_roles, logged_in_client):
    from employees.factories import DepartmentFactory

    department = DepartmentFactory(name="Engineering")
    client = logged_in_client(starter_roles["Employee"])

    resp = client.get("/api/v1/departments/")

    body = resp.json()
    assert body["success"] is True
    row = next(d for d in body["data"] if d["id"] == str(department.pk))
    assert row == {"id": str(department.pk), "name": "Engineering"}
