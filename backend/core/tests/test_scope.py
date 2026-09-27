"""Proves core.scope.resolve_employee_scope for every implemented tier, plus the
UserPermissionOverride precedence rules. This is the concrete, automated proof
that the IDOR fix this function exists for actually holds — see docs/TASKS.md
P1-SH-01. department/location/legal_entity tiers are exercised here too, ahead
of Phase 2's Employee FK wiring being load-bearing anywhere else, since the
models and resolver dispatch for them already exist.
"""

import pytest

from accounts.factories import (
    PermissionFactory,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
    UserPermissionOverrideFactory,
)
from core.enums import ScopeTier
from core.scope import resolve_employee_scope, user_effective_permissions, user_has_permission
from employees.factories import (
    DepartmentFactory,
    EmployeeFactory,
    LegalEntityFactory,
    LocationFactory,
)

pytestmark = pytest.mark.django_db


def _ids(queryset):
    return set(queryset.values_list("pk", flat=True))


def test_no_role_no_override_denies():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    permission = PermissionFactory(code="leave.approve")

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == set()


def test_unknown_permission_denies():
    user = UserFactory()
    EmployeeFactory(user=user)

    result = resolve_employee_scope(user, "does.not.exist")

    assert _ids(result) == set()


def test_self_scope_returns_only_caller():
    permission = PermissionFactory(code="attendance.clockin")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.SELF)
    user = UserFactory(role=role)
    employee = EmployeeFactory(user=user)
    other = EmployeeFactory()

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {employee.pk}
    assert other.pk not in _ids(result)


def test_manager_scope_is_direct_reports_plus_self_no_skip_level():
    permission = PermissionFactory(code="leave.approve")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.MANAGER)
    user = UserFactory(role=role)
    manager = EmployeeFactory(user=user)
    direct_report = EmployeeFactory(manager=manager)
    skip_level_report = EmployeeFactory(manager=direct_report)
    stranger = EmployeeFactory()

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {manager.pk, direct_report.pk}
    assert skip_level_report.pk not in _ids(result)
    assert stranger.pk not in _ids(result)


def test_team_scope_includes_full_transitive_subtree():
    permission = PermissionFactory(code="attendance.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.TEAM)
    user = UserFactory(role=role)
    exec_employee = EmployeeFactory(user=user)
    direct_report = EmployeeFactory(manager=exec_employee)
    indirect_report = EmployeeFactory(manager=direct_report)
    deep_report = EmployeeFactory(manager=indirect_report)
    outside_org = EmployeeFactory()

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {
        exec_employee.pk,
        direct_report.pk,
        indirect_report.pk,
        deep_report.pk,
    }
    assert outside_org.pk not in _ids(result)


def test_department_scope_covers_whole_department():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.DEPARTMENT)
    department = DepartmentFactory()
    other_department = DepartmentFactory()
    user = UserFactory(role=role)
    employee = EmployeeFactory(user=user, department=department)
    same_department_peer = EmployeeFactory(department=department)
    other_department_peer = EmployeeFactory(department=other_department)

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {employee.pk, same_department_peer.pk}
    assert other_department_peer.pk not in _ids(result)


def test_location_scope_covers_whole_location():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.LOCATION)
    location = LocationFactory()
    user = UserFactory(role=role)
    employee = EmployeeFactory(user=user, location=location)
    same_location_peer = EmployeeFactory(location=location)
    other_location_peer = EmployeeFactory(location=LocationFactory())

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {employee.pk, same_location_peer.pk}
    assert other_location_peer.pk not in _ids(result)


def test_legal_entity_scope_covers_whole_entity():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.LEGAL_ENTITY)
    entity = LegalEntityFactory()
    user = UserFactory(role=role)
    employee = EmployeeFactory(user=user, legal_entity=entity)
    same_entity_peer = EmployeeFactory(legal_entity=entity)
    other_entity_peer = EmployeeFactory(legal_entity=LegalEntityFactory())

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {employee.pk, same_entity_peer.pk}
    assert other_entity_peer.pk not in _ids(result)


def test_all_scope_covers_every_employee():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    caller = EmployeeFactory(user=user)
    others = [EmployeeFactory() for _ in range(3)]

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {caller.pk, *(o.pk for o in others)}


def test_user_permission_override_widens_scope_for_one_user_only():
    permission = PermissionFactory(code="expense.approve")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.SELF)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    other_user_same_role = UserFactory(role=role)
    EmployeeFactory(user=other_user_same_role)
    other_employee = EmployeeFactory()
    UserPermissionOverrideFactory(
        user=user, permission=permission, scope_tier=ScopeTier.ALL, is_granted=True
    )

    result = resolve_employee_scope(user, permission.code)
    other_result = resolve_employee_scope(other_user_same_role, permission.code)

    assert other_employee.pk in _ids(result)
    assert _ids(other_result) == {other_user_same_role.employee.pk}


def test_user_permission_override_can_explicitly_deny():
    permission = PermissionFactory(code="salary.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user, permission=permission, scope_tier=ScopeTier.ALL, is_granted=False
    )

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == set()


# --- a deactivated role must grant nothing ---


def _user_with_role_granting(code, tier=ScopeTier.ALL, role_active=True):
    permission = PermissionFactory(code=code)
    role = RoleFactory(is_active=role_active)
    RolePermissionFactory(role=role, permission=permission, scope_tier=tier)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    return user


def test_deactivated_role_grants_no_scope_or_capability():
    user = _user_with_role_granting("salary.read", role_active=False)

    assert _ids(resolve_employee_scope(user, "salary.read")) == set()
    assert user_has_permission(user, "salary.read") is False
    assert "salary.read" not in user_effective_permissions(user)


def test_active_role_still_grants_as_before():
    user = _user_with_role_granting("salary.read", role_active=True)

    assert user_has_permission(user, "salary.read") is True
    assert "salary.read" in user_effective_permissions(user)


def test_override_still_grants_when_the_role_is_deactivated():
    """Deactivating a role removes what the role gave; a per-person grant is
    a separate decision and stays."""
    user = _user_with_role_granting("salary.read", role_active=False)
    permission = PermissionFactory(code="salary.read")
    UserPermissionOverrideFactory(
        user=user, permission=permission, scope_tier=ScopeTier.SELF, is_granted=True
    )

    assert user_has_permission(user, "salary.read") is True


# --- code-review fix: manager cycles must not hang the TEAM-tier query ---


def test_team_scope_terminates_on_a_two_node_manager_cycle():
    """Nothing elsewhere prevents a manager cycle from entering the data —
    this proves the recursive CTE's cycle guard actually stops it from
    recursing forever, rather than trusting the guard exists by reading the
    SQL. Without the fix this test would hang the test run."""
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.TEAM)
    user = UserFactory(role=role)
    a = EmployeeFactory(user=user)
    b = EmployeeFactory(manager=a)
    a.manager = b
    a.save(update_fields=["manager"])

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {a.pk, b.pk}


def test_team_scope_terminates_on_a_longer_manager_cycle():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.TEAM)
    user = UserFactory(role=role)
    a = EmployeeFactory(user=user)
    b = EmployeeFactory(manager=a)
    c = EmployeeFactory(manager=b)
    a.manager = c
    a.save(update_fields=["manager"])
    outside_cycle = EmployeeFactory()

    result = resolve_employee_scope(user, permission.code)

    assert _ids(result) == {a.pk, b.pk, c.pk}
    assert outside_cycle.pk not in _ids(result)


def test_all_tier_without_own_employee_record_sees_everyone():
    """An org-wide (ALL tier) grant covers every employee and must not depend on
    the caller having an Employee row of their own — the seeded superadmin has
    none. Regression: resolve_employee_scope used to return an empty queryset
    for such a user, blanking the employee directory for admins."""
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    admin = UserFactory(role=role)  # no EmployeeFactory — admin is not an employee
    others = [EmployeeFactory() for _ in range(3)]

    result = resolve_employee_scope(admin, permission.code)

    assert _ids(result) == {e.pk for e in others}


def test_specialised_role_keeps_self_service_baseline():
    """A role built with only its job permissions still lets the holder do their
    own everyday things (apply for own leave, see own payslip/profile) — the
    self-service baseline is granted at SELF tier to any employee, no matter their
    role. Regression for the cross-module 'special role loses employee access' bug."""
    payroll_only = PermissionFactory(code="payroll.manage")
    own_leave = PermissionFactory(code="example_leave.write")  # a baseline code
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=payroll_only, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    me = EmployeeFactory(user=user)
    coworker = EmployeeFactory()

    # baseline self-service works despite the role never granting it...
    leave_scope = resolve_employee_scope(user, "example_leave.write")
    assert _ids(leave_scope) == {me.pk}          # only their own record
    assert coworker.pk not in _ids(leave_scope)  # not anyone else's
    assert user_has_permission(user, "ess.profile.read")
    assert "payroll.read" in user_effective_permissions(user)  # baseline in flat set


def test_baseline_can_still_be_denied_by_override():
    """The baseline is a floor, not immovable: an explicit deny override still
    removes a self-service permission for one person (e.g. a suspended employee)."""
    perm = PermissionFactory(code="example_leave.write")
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user, permission=perm, scope_tier=ScopeTier.SELF, is_granted=False
    )

    assert not user_has_permission(user, "example_leave.write")
    assert "example_leave.write" not in user_effective_permissions(user)


def test_baseline_does_not_apply_to_non_employee():
    """A user with no employee record (e.g. an org-wide admin) is not an employee,
    so the self-service baseline does not manufacture access for them."""
    user = UserFactory(role=None)  # no EmployeeFactory
    assert not user_has_permission(user, "ess.profile.read")


# --- multi-role RBAC (docs/MULTI-ROLE-TESTS.md §A): union across active roles ---

from core.scope import (  # noqa: E402
    _resolve_effective_scope,
    baseline_self_permissions,
    explain_permission,
    resolve_management_scope,
)


def _role_granting(code, tier, active=True):
    permission = PermissionFactory(code=code)
    role = RoleFactory(is_active=active)
    RolePermissionFactory(role=role, permission=permission, scope_tier=tier)
    return role


def test_a1_single_role_regression():
    role = _role_granting("employees.read", ScopeTier.TEAM)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    tier, granted = _resolve_effective_scope(user, "employees.read")

    assert granted is True and tier == ScopeTier.TEAM
    assert user_has_permission(user, "employees.read") is True


def test_a2_no_roles_employee_gets_only_baseline():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)

    assert user_effective_permissions(user) == set(baseline_self_permissions())
    code = next(iter(baseline_self_permissions()))
    assert _resolve_effective_scope(user, code) == (ScopeTier.SELF, True)
    assert user_has_permission(user, "roles.manage") is False


def test_a3_no_roles_non_employee_gets_nothing():
    user = UserFactory(role=None)  # no EmployeeFactory

    assert user_effective_permissions(user) == set()
    assert user_has_permission(user, "ess.profile.read") is False
    assert _resolve_effective_scope(user, "ess.profile.read") == (None, False)


def test_a4_two_roles_broadest_tier_wins():
    r1 = _role_granting("employees.read", ScopeTier.TEAM)
    r2 = _role_granting("employees.read", ScopeTier.DEPARTMENT)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.DEPARTMENT, True)


def test_a5_two_roles_one_all():
    r1 = _role_granting("employees.read", ScopeTier.MANAGER)
    r2 = _role_granting("employees.read", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.ALL, True)


def test_a6_two_roles_disjoint_codes():
    r1 = _role_granting("payroll.read", ScopeTier.ALL)
    r2 = _role_granting("org.manage", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "payroll.read") == (ScopeTier.ALL, True)
    assert _resolve_effective_scope(user, "org.manage") == (ScopeTier.ALL, True)
    assert {"payroll.read", "org.manage"} <= user_effective_permissions(user)


def test_a7_broadest_tie_is_idempotent():
    r1 = _role_granting("employees.read", ScopeTier.DEPARTMENT)
    r2 = _role_granting("employees.read", ScopeTier.DEPARTMENT)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.DEPARTMENT, True)


def test_a8_duplicate_membership_is_one():
    role = _role_granting("employees.read", ScopeTier.TEAM)
    user = UserFactory()
    user.roles.add(role, role)
    EmployeeFactory(user=user)

    assert user.roles.count() == 1
    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.TEAM, True)


def test_a9_inactive_role_contributes_nothing():
    r1 = _role_granting("employees.read", ScopeTier.TEAM, active=True)
    r2 = _role_granting("employees.read", ScopeTier.ALL, active=False)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.TEAM, True)


def test_a10_all_roles_inactive_falls_back():
    role = _role_granting("employees.write", ScopeTier.ALL, active=False)
    user = UserFactory()
    user.roles.add(role)
    EmployeeFactory(user=user)

    # employees.write is outside the baseline, so this is a clean deny.
    assert user_has_permission(user, "employees.write") is False
    assert "employees.write" not in user_effective_permissions(user)


def test_a11_self_vs_broader():
    r1 = _role_granting("ess.profile.read", ScopeTier.SELF)
    r2 = _role_granting("ess.profile.read", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "ess.profile.read") == (ScopeTier.ALL, True)


def test_a12_narrowest_only():
    role = _role_granting("audit.read", ScopeTier.SELF)
    user = UserFactory()
    user.roles.add(role)
    EmployeeFactory(user=user)

    assert _resolve_effective_scope(user, "audit.read") == (ScopeTier.SELF, True)


# --- multi-role RBAC (docs/MULTI-ROLE-TESTS.md §B): override layer over many roles ---


def test_b1_deny_beats_every_role():
    r1 = _role_granting("payroll.read", ScopeTier.ALL)
    r2 = _role_granting("payroll.read", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="payroll.read"),
        scope_tier=ScopeTier.ALL,
        is_granted=False,
    )

    assert user_has_permission(user, "payroll.read") is False
    assert "payroll.read" not in user_effective_permissions(user)
    assert _ids(resolve_employee_scope(user, "payroll.read")) == set()


def test_b2_deny_beats_baseline():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    assert user_has_permission(user, "ess.profile.read") is True
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="ess.profile.read"),
        scope_tier=ScopeTier.SELF,
        is_granted=False,
    )
    # The resolver memoizes per user instance for one request; a fresh
    # instance (like the next request's) sees the new override.
    user._scope_resolution_cache = {}

    assert user_has_permission(user, "ess.profile.read") is False


def test_b3_grant_adds_a_code_no_role_has():
    role = _role_granting("payroll.read", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(role)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="org.manage"),
        scope_tier=ScopeTier.DEPARTMENT,
        is_granted=True,
    )

    assert _resolve_effective_scope(user, "org.manage") == (ScopeTier.DEPARTMENT, True)


def test_b4_grant_narrower_than_roles_still_wins():
    r1 = _role_granting("employees.read", ScopeTier.ALL)
    r2 = _role_granting("employees.read", ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="employees.read"),
        scope_tier=ScopeTier.TEAM,
        is_granted=True,
    )

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.TEAM, True)


def test_b5_grant_broader_than_roles():
    role = _role_granting("employees.read", ScopeTier.TEAM)
    user = UserFactory()
    user.roles.add(role)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="employees.read"),
        scope_tier=ScopeTier.ALL,
        is_granted=True,
    )

    assert _resolve_effective_scope(user, "employees.read") == (ScopeTier.ALL, True)


def test_b6_override_source_labels():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="org.manage"),
        scope_tier=ScopeTier.ALL,
        is_granted=True,
    )
    UserPermissionOverrideFactory(
        user=user,
        permission=PermissionFactory(code="payroll.read"),
        scope_tier=ScopeTier.SELF,
        is_granted=False,
    )

    assert explain_permission(user, "org.manage")["source"] == "override"
    assert explain_permission(user, "payroll.read")["source"] == "override (deny)"


# --- multi-role RBAC (docs/MULTI-ROLE-TESTS.md §C): scope queryset ---


def test_c1_two_roles_scope_is_broadest():
    r_team = _role_granting("employees.read", ScopeTier.TEAM)
    r_dept = _role_granting("employees.read", ScopeTier.DEPARTMENT)
    department = DepartmentFactory()
    other_department = DepartmentFactory()
    user = UserFactory()
    user.roles.add(r_team, r_dept)
    caller = EmployeeFactory(user=user, department=department)
    peer = EmployeeFactory(department=department)
    outsider = EmployeeFactory(department=other_department)

    assert _ids(resolve_employee_scope(user, "employees.read")) == {caller.pk, peer.pk}
    assert outsider.pk not in _ids(resolve_employee_scope(user, "employees.read"))


def test_c2_any_role_at_all_sees_everyone_without_own_record():
    r1 = _role_granting("employees.read", ScopeTier.TEAM)
    r2 = _role_granting("employees.read", ScopeTier.ALL)
    user = UserFactory()  # no EmployeeFactory
    user.roles.add(r1, r2)
    others = [EmployeeFactory() for _ in range(2)]

    assert _ids(resolve_employee_scope(user, "employees.read")) == {e.pk for e in others}


def test_c3_no_grant_is_none():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    PermissionFactory(code="employees.write")

    assert _ids(resolve_employee_scope(user, "employees.write")) == set()


def test_c4_management_scope_uses_broadest_union_tier():
    r_team = _role_granting("employees.read", ScopeTier.TEAM)
    r_dept = _role_granting("employees.read", ScopeTier.DEPARTMENT)
    department = DepartmentFactory()
    user = UserFactory()
    user.roles.add(r_team, r_dept)
    caller = EmployeeFactory(user=user, department=department)
    peer = EmployeeFactory(department=department)

    scope = resolve_management_scope(user)

    assert scope["kind"] == "team"
    assert set(scope["employeeIds"]) == {str(caller.pk), str(peer.pk)}
