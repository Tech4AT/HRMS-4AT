"""The extra data the admin screens read: access preview, role user counts,
and readable names on personal exceptions."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import (
    PermissionFactory,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
    UserPermissionOverrideFactory,
)
from accounts.models import Role
from core.enums import ScopeTier
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _person_with(code, tier, **user_fields):
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=PermissionFactory(code=code), scope_tier=tier)
    user = UserFactory(role=role, **user_fields)
    employee = EmployeeFactory(user=user)
    return user, employee


def _preview(client, user, code=None):
    params = {"permission": code} if code else {}
    return client.get(f"/api/v1/users/{user.pk}/access-preview/", params)


def test_preview_names_exactly_who_a_manager_can_reach():
    boss, boss_emp = _person_with("employees.read", ScopeTier.MANAGER, first_name="Bea")
    EmployeeFactory(manager=boss_emp, user=UserFactory(first_name="Rae", last_name="Report"))
    EmployeeFactory()  # a stranger, must not be listed

    data = _preview(_hr(), boss).json()["data"]

    assert data["granted"] is True and data["tier"] == "manager" and data["source"] == "role"
    assert data["reachCount"] == 2
    assert {p["name"] for p in data["people"]} == {"Bea", "Rae Report"}
    assert data["truncated"] is False


def test_preview_reports_no_access_with_the_reason():
    role = RoleFactory()
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    data = _preview(_hr(), user).json()["data"]

    assert data["granted"] is False and data["source"] == "none"
    assert data["reachCount"] == 0 and data["people"] == []


def test_preview_shows_a_personal_exception_as_the_source():
    user, _ = _person_with("employees.read", ScopeTier.SELF)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="employees.read"),
        scope_tier=ScopeTier.ALL,
        is_granted=True,
    )

    data = _preview(_hr(), user).json()["data"]

    assert data["source"] == "override" and data["tier"] == "all"


def test_preview_explains_a_deactivated_role():
    role = RoleFactory(is_active=False)
    RolePermissionFactory(
        role=role, permission=PermissionFactory(code="employees.read"), scope_tier=ScopeTier.ALL
    )
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    data = _preview(_hr(), user).json()["data"]

    assert data["granted"] is False and data["source"] == "role (inactive)"


def test_preview_rejects_an_unknown_permission():
    user, _ = _person_with("employees.read", ScopeTier.SELF)

    response = _preview(_hr(), user, "nope.nope")

    assert response.status_code == 400
    assert "permission" in response.json()["error"]["fields"]


def test_preview_is_admin_only():
    user, _ = _person_with("employees.read", ScopeTier.ALL)
    client = APIClient()
    client.force_authenticate(user=user)

    assert _preview(client, user).status_code == 403


def test_role_list_shows_how_many_people_hold_each_role():
    role = RoleFactory(name="Test Counted Role")
    UserFactory(role=role)
    UserFactory(role=role)

    rows = _hr().get("/api/v1/roles/", {"pageSize": 100}).json()["results"]

    assert next(r for r in rows if r["name"] == "Test Counted Role")["userCount"] == 2


def test_personal_exceptions_carry_the_persons_name_and_email():
    user = UserFactory(first_name="Pia", last_name="Person", email="pia@example.com")
    UserPermissionOverrideFactory(user=user, permission=PermissionFactory(code="employees.read"))

    rows = _hr().get("/api/v1/user-permission-overrides/", {"user": user.pk}).json()["results"]

    assert rows[0]["userName"] == "Pia Person" and rows[0]["userEmail"] == "pia@example.com"


def test_permissions_catalog_exposes_label_and_group():
    PermissionFactory(
        code="employees.read",
        description="View employee directory records within the holder's scope",
        label="View employee records",
        group="Employee data",
    )

    rows = _hr().get("/api/v1/permissions/", {"pageSize": 100}).json()["results"]

    row = next(r for r in rows if r["code"] == "employees.read")
    assert row["label"] == "View employee records"
    assert row["group"] == "Employee data"
    assert row["description"].startswith("View employee directory")


def test_permissions_catalog_hides_disabled_modules():
    PermissionFactory(code="example_leave.read")
    PermissionFactory(code="onboarding.read")

    codes = {
        r["code"] for r in _hr().get("/api/v1/permissions/", {"pageSize": 100}).json()["results"]
    }

    assert "employees.read" in codes
    assert "example_leave.read" not in codes
    assert "onboarding.read" not in codes


def test_sync_backfills_label_and_group_but_keeps_edits():
    from accounts.models import Permission
    from core import registry
    from core.registry import ModuleSpec, PermissionSpec, register_module

    snapshot = (
        dict(registry._REGISTRY),
        dict(registry._MODULES),
        dict(registry._PERMISSION_MODULE),
    )
    try:
        register_module(
            ModuleSpec(
                key="zmod",
                label="Zed Module",
                enabled=True,
                permissions=(
                    PermissionSpec("zmod.read", "From code", label="From code label"),
                ),
            )
        )
        Permission.objects.create(code="zmod.read", description="", label="", group="")
        Permission.objects.create(
            code="zmod.edited", description="Edited", label="Edited label", group="Edited group"
        )
        registry._REGISTRY["zmod.edited"] = PermissionSpec("zmod.edited", "From code")

        registry.sync_registered_permissions()

        filled = Permission.objects.get(code="zmod.read")
        assert filled.label == "From code label"
        assert filled.group == "Zed Module"
        kept = Permission.objects.get(code="zmod.edited")
        assert (kept.label, kept.group) == ("Edited label", "Edited group")
    finally:
        registry._REGISTRY.clear()
        registry._REGISTRY.update(snapshot[0])
        registry._MODULES.clear()
        registry._MODULES.update(snapshot[1])
        registry._PERMISSION_MODULE.clear()
        registry._PERMISSION_MODULE.update(snapshot[2])
