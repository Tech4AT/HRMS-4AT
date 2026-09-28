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
from accounts.models import Role, User
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

    # employees.write is outside the self-service baseline, so an employee
    # with an empty role genuinely holds nothing here (source 'none').
    data = _preview(_hr(), user, "employees.write").json()["data"]

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
        role=role, permission=PermissionFactory(code="employees.write"), scope_tier=ScopeTier.ALL
    )
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    # Probe outside the self-service baseline so the inactive role (not the
    # baseline grant) decides the outcome.
    data = _preview(_hr(), user, "employees.write").json()["data"]

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
    # NOTE (known duplication): this description is the copy seeded by
    # migration 0002_seed_starter_roles ('Read employee records'), NOT the one
    # in employees/rbac.py ('View employee directory ...'). sync backfills
    # blank descriptions only — an admin-edited description is always kept
    # (core/tests/test_registry_and_checks.py pins this), so sync cannot tell
    # a stale seed from an edit and the seeded text wins here. rbac.py stays
    # authoritative for label/group. Realign the seed if this ever matters.
    assert row["description"] == "Read employee records"


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


# --- multi-role RBAC (docs/MULTI-ROLE-TESTS.md §D/E/F) ---

from core.scope import user_effective_permissions  # noqa: E402


def _manager_client_with_roles_manage():
    """An admin caller whose roles.manage comes from one of several roles."""
    from accounts.factories import UserPermissionOverrideFactory  # noqa: F401

    manage = PermissionFactory(code="roles.manage")
    admin_role = RoleFactory(name="E Admin")
    RolePermissionFactory(role=admin_role, permission=manage, scope_tier=ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(admin_role)
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user, admin_role


def test_d1_effective_set_is_union_across_roles():
    r1 = RoleFactory(name="D1 R1")
    RolePermissionFactory(
        role=r1, permission=PermissionFactory(code="payroll.read"), scope_tier=ScopeTier.ALL
    )
    r2 = RoleFactory(name="D1 R2")
    RolePermissionFactory(
        role=r2, permission=PermissionFactory(code="org.manage"), scope_tier=ScopeTier.ALL
    )
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    effective = user_effective_permissions(user)

    assert {"payroll.read", "org.manage"} <= effective
    assert set(baseline_self_permissions_for_test()) <= effective


def baseline_self_permissions_for_test():
    from core.scope import baseline_self_permissions

    return baseline_self_permissions()


def test_d5_preview_matches_contract_for_multi_role_user():
    client, _, _ = _manager_client_with_roles_manage()
    r1 = RoleFactory(name="D5 R1")
    RolePermissionFactory(
        role=r1, permission=PermissionFactory(code="employees.read"), scope_tier=ScopeTier.TEAM
    )
    r2 = RoleFactory(name="D5 R2")
    RolePermissionFactory(
        role=r2,
        permission=PermissionFactory(code="employees.read"),
        scope_tier=ScopeTier.DEPARTMENT,
    )
    from employees.factories import DepartmentFactory

    department = DepartmentFactory()
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user, department=department)
    EmployeeFactory(department=department)

    data = _preview(client, user, "employees.read").json()["data"]

    assert data["granted"] is True and data["tier"] == "department" and data["source"] == "role"
    assert data["reachCount"] == 2


def test_e1_assign_multiple_roles_to_a_user():
    client, _, _ = _manager_client_with_roles_manage()
    r1, r2 = RoleFactory(name="E1 R1"), RoleFactory(name="E1 R2")
    target = UserFactory(role=None)
    EmployeeFactory(user=target)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": [r1.pk, r2.pk]}, format="json")

    assert resp.status_code == 200
    assert sorted(resp.json()["roles"], key=lambda r: r["id"]) == sorted(
        [{"id": r1.pk, "name": "E1 R1"}, {"id": r2.pk, "name": "E1 R2"}],
        key=lambda r: r["id"],
    )
    target.refresh_from_db()
    assert set(target.roles.values_list("pk", flat=True)) == {r1.pk, r2.pk}


def test_e2_remove_a_role_shrinks_effective_perms():
    client, _, _ = _manager_client_with_roles_manage()
    r1 = RoleFactory(name="E2 R1")
    RolePermissionFactory(
        role=r1, permission=PermissionFactory(code="org.manage"), scope_tier=ScopeTier.ALL
    )
    r2 = RoleFactory(name="E2 R2")
    target = UserFactory()
    target.roles.add(r1, r2)
    EmployeeFactory(user=target)
    assert "org.manage" in user_effective_permissions(target)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": [r2.pk]}, format="json")

    assert resp.status_code == 200
    target.refresh_from_db()
    assert list(target.roles.values_list("pk", flat=True)) == [r2.pk]
    target._scope_resolution_cache = {}
    assert "org.manage" not in user_effective_permissions(target)


def test_e3_assign_zero_roles_is_baseline_only():
    from core.scope import baseline_self_permissions

    client, _, _ = _manager_client_with_roles_manage()
    role = RoleFactory(name="E3 R1")
    target = UserFactory()
    target.roles.add(role)
    EmployeeFactory(user=target)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": []}, format="json")

    assert resp.status_code == 200
    assert resp.json()["roles"] == []
    target.refresh_from_db()
    assert target.roles.count() == 0
    assert user_effective_permissions(target) == set(baseline_self_permissions())


def test_e4_non_admin_forbidden_from_assigning():
    plain = UserFactory(role=None)
    EmployeeFactory(user=plain)
    client = APIClient()
    client.force_authenticate(user=plain)
    target = UserFactory(role=None)

    resp = client.patch(
        f"/api/v1/users/{target.pk}/", {"roleIds": [RoleFactory(name="E4 R").pk]}, format="json"
    )

    assert resp.status_code == 403


def test_e5_inactive_role_membership_contributes_nothing():
    # Pinned decision: accepted, but contributes nothing.
    client, _, _ = _manager_client_with_roles_manage()
    quiet = RoleFactory(name="E5 Quiet", is_active=False)
    RolePermissionFactory(
        role=quiet, permission=PermissionFactory(code="org.manage"), scope_tier=ScopeTier.ALL
    )
    target = UserFactory(role=None)
    EmployeeFactory(user=target)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": [quiet.pk]}, format="json")

    assert resp.status_code == 200
    target.refresh_from_db()
    assert list(target.roles.values_list("pk", flat=True)) == [quiet.pk]
    assert user_has_permission_for_test(target, "org.manage") is False


def user_has_permission_for_test(user, code):
    from core.scope import user_has_permission

    user._scope_resolution_cache = {}
    return user_has_permission(user, code)


def test_e6_self_lockout_guard_drops_last_roles_manage():
    client, me, _ = _manager_client_with_roles_manage()
    plain = RoleFactory(name="E6 Plain")

    resp = client.patch(f"/api/v1/users/{me.pk}/", {"roleIds": [plain.pk]}, format="json")

    assert resp.status_code == 403
    me.refresh_from_db()
    assert me_has_roles_manage(me) is True


def me_has_roles_manage(me):
    from core.scope import user_has_permission

    me._scope_resolution_cache = {}
    return user_has_permission(me, "roles.manage")


def test_e_unknown_role_ids_rejected():
    client, _, _ = _manager_client_with_roles_manage()
    target = UserFactory(role=None)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": [999999]}, format="json")

    assert resp.status_code == 400


def test_f1_add_users_to_a_role():
    client, _, _ = _manager_client_with_roles_manage()
    role = RoleFactory(name="F1 Role")
    u1, u2 = UserFactory(), UserFactory()
    other_role = RoleFactory(name="F1 Other")
    u2.roles.add(other_role)

    resp = client.post(
        f"/api/v1/roles/{role.pk}/add-users/", {"userIds": [u1.pk, u2.pk]}, format="json"
    )

    assert resp.status_code == 200
    assert sorted(resp.json()["users"]) == sorted([u1.pk, u2.pk])
    assert set(u1.roles.values_list("pk", flat=True)) == {role.pk}
    # u2 keeps their pre-existing membership too.
    assert set(User.objects.get(pk=u2.pk).roles.values_list("pk", flat=True)) == {
        role.pk,
        other_role.pk,
    }


def test_f2_remove_users_from_a_role_keeps_other_roles():
    client, _, _ = _manager_client_with_roles_manage()
    role = RoleFactory(name="F2 Role")
    keeper = RoleFactory(name="F2 Keeper")
    u1 = UserFactory()
    u1.roles.add(role, keeper)

    resp = client.post(
        f"/api/v1/roles/{role.pk}/remove-users/", {"userIds": [u1.pk]}, format="json"
    )

    assert resp.status_code == 200
    assert list(User.objects.get(pk=u1.pk).roles.values_list("pk", flat=True)) == [keeper.pk]


def test_f3_role_user_count_reflects_membership():
    client, _, _ = _manager_client_with_roles_manage()
    role = RoleFactory(name="F3 Role")
    u1, u2 = UserFactory(), UserFactory()

    assert client.get("/api/v1/roles/", {"pageSize": 100}).json()["results"]
    client.post(f"/api/v1/roles/{role.pk}/add-users/", {"userIds": [u1.pk, u2.pk]}, format="json")
    row = next(
        r
        for r in client.get("/api/v1/roles/", {"pageSize": 100}).json()["results"]
        if r["name"] == "F3 Role"
    )
    assert row["userCount"] == 2 and sorted(row["users"]) == sorted([u1.pk, u2.pk])

    client.post(f"/api/v1/roles/{role.pk}/remove-users/", {"userIds": [u1.pk]}, format="json")
    row = next(
        r
        for r in client.get("/api/v1/roles/", {"pageSize": 100}).json()["results"]
        if r["name"] == "F3 Role"
    )
    assert row["userCount"] == 1 and row["users"] == [u2.pk]


def test_f4_delete_role_with_members_stays_blocked():
    client, _, _ = _manager_client_with_roles_manage()
    role = RoleFactory(name="F4 Held")
    holder = UserFactory()
    holder.roles.add(role)

    resp = client.delete(f"/api/v1/roles/{role.pk}/")

    assert resp.status_code == 409
    assert "1 person" in resp.json()["error"]["message"]
    assert Role.objects.filter(pk=role.pk).exists()
