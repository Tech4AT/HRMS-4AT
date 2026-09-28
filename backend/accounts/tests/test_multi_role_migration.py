"""Multi-role migration (docs/MULTI-ROLE-TESTS.md §G): the 0014 migration
converts each user's single role FK into exactly one M2M membership (null
→ zero memberships) with ZERO access drift, and leaves employee data and
login intact.

These tests drive the real migration graph with MigrationExecutor: back to
accounts 0013 (the old FK world), build old-shape data, forward to 0014,
and compare.
"""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

PRE = ("accounts", "0013_permission_label_group")

pytestmark = pytest.mark.django_db(transaction=True)


def _targets(back=False):
    executor = MigrationExecutor(connection)
    leaves = dict(executor.loader.graph.leaf_nodes())
    if back:
        leaves["accounts"] = "0013_permission_label_group"
    return [(app, name) for app, name in leaves.items()]


def _migrate(back=False):
    executor = MigrationExecutor(connection)
    executor.migrate(_targets(back=back))
    return executor


def _seed_old_world(apps):
    """Old-shape data at 0013: roles with grants at distinct tiers, users
    with a role / another role / null, employees for some, one grant and
    one deny override. Returns handle dicts for the drift comparison."""
    User = apps.get_model("accounts", "User")
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")
    Override = apps.get_model("accounts", "UserPermissionOverride")
    Employee = apps.get_model("employees", "Employee")

    p_read, _ = Permission.objects.get_or_create(code="employees.read")
    p_write, _ = Permission.objects.get_or_create(code="employees.write")
    p_pay, _ = Permission.objects.get_or_create(code="payroll.read")
    r_team = Role.objects.create(name="G Team", archetype="employee")
    r_all = Role.objects.create(name="G All", archetype="admin")
    RolePermission.objects.create(role=r_team, permission=p_read, scope_tier="team")
    RolePermission.objects.create(role=r_team, permission=p_write, scope_tier="team")
    RolePermission.objects.create(role=r_all, permission=p_read, scope_tier="all")
    RolePermission.objects.create(role=r_all, permission=p_pay, scope_tier="all")

    def mkuser(name, role, employee):
        from django.contrib.auth.hashers import make_password

        u = User.objects.create(
            username=name, email=f"{name}@example.com", password=make_password("Old-Pass-123!")
        )
        # Old world: direct FK assignment.
        u.role = role
        u.save(update_fields=["role"])
        if employee:
            Employee.objects.create(user=u, employee_code=f"G-{name.upper()}")
        return u

    alice = mkuser("galice", r_team, True)
    bob = mkuser("gbob", r_all, True)
    cara = mkuser("gcara", None, True)
    ned = mkuser("gned", None, False)
    # Override grant on a code no role has; override deny on a granted code.
    Override.objects.create(user=alice, permission=p_pay, scope_tier="department", is_granted=True)
    Override.objects.create(user=bob, permission=p_read, scope_tier="all", is_granted=False)
    return {
        "users": {
            u.pk: {
                "role_id": u.role_id,
                "employee": Employee.objects.filter(user_id=u.pk).exists(),
            }
            for u in (alice, bob, cara, ned)
        },
        "role_ids": {"team": r_team.pk, "all": r_all.pk},
        "passwords": {alice.pk: "Old-Pass-123!"},
    }


def _old_effective(apps, snapshot):
    """Effective {code: tier} per user under the OLD single-role semantics:
    override wins; else the user's role grant; else baseline SELF for
    employees. Reimplements the pre-feature resolver faithfully (the old
    code is gone — this is the point of the comparison)."""
    from core.scope import baseline_self_permissions

    User = apps.get_model("accounts", "User")
    RolePermission = apps.get_model("accounts", "RolePermission")
    Override = apps.get_model("accounts", "UserPermissionOverride")
    baseline = set(baseline_self_permissions())

    grants = {}
    for rp in RolePermission.objects.select_related("role", "permission"):
        grants[(rp.role_id, rp.permission.code)] = rp.scope_tier
    overrides = {}
    for o in Override.objects.select_related("permission"):
        overrides[(o.user_id, o.permission.code)] = (o.scope_tier, o.is_granted)

    effective = {}
    for pk, info in snapshot["users"].items():
        codes = {}
        denied = set()
        for (rid, code), tier in grants.items():
            if rid == info["role_id"] and rid is not None:
                codes[code] = tier
        for (uid, code), (tier, granted) in overrides.items():
            if uid != pk:
                continue
            if granted:
                codes[code] = tier
            else:
                # A deny wins outright — the baseline must NOT re-add it
                # (the old resolver returned before ever reaching baseline).
                codes.pop(code, None)
                denied.add(code)
        if info["employee"]:
            for code in baseline:
                if code not in denied:
                    codes.setdefault(code, "self")
        effective[pk] = codes
    return effective


def test_g1_forward_migration_creates_one_membership_per_role():
    _migrate(back=True)
    apps = MigrationExecutor(connection).loader.project_state(_targets(back=True)).apps
    snapshot = _seed_old_world(apps)

    _migrate(back=False)

    from accounts.models import User

    memberships = {
        u.pk: sorted(u.roles.values_list("pk", flat=True)) for u in User.objects.all()
    }
    team, all_ = snapshot["role_ids"]["team"], snapshot["role_ids"]["all"]
    for pk, info in snapshot["users"].items():
        if info["role_id"] is None:
            assert memberships[pk] == [], "null role migrates to zero memberships (G3)"
        else:
            assert memberships[pk] == [info["role_id"]]
    assert [memberships[p] for p, i in snapshot["users"].items() if i["role_id"] == team] == [
        [team]
    ]
    assert [memberships[p] for p, i in snapshot["users"].items() if i["role_id"] == all_] == [
        [all_]
    ]


def test_g2_no_access_drift_for_any_user():
    _migrate(back=True)
    apps = MigrationExecutor(connection).loader.project_state(_targets(back=True)).apps
    snapshot = _seed_old_world(apps)
    before = _old_effective(apps, snapshot)

    _migrate(back=False)

    from accounts.models import User
    from core.scope import _resolve_effective_scope

    for user in User.objects.all():
        user._scope_resolution_cache = {}
        after = {}
        for code in set(before[user.pk]) | {
            c for c, _ in [_resolve_effective_scope(user, code) for code in before[user.pk]]
        }:
            tier, granted = _resolve_effective_scope(user, code)
            if granted:
                after[code] = tier
        # Full effective-set comparison, not just the sampled codes.
        from core.scope import user_effective_permissions

        assert set(after) == set(before[user.pk]), f"drift for user {user.pk}"
        assert after == before[user.pk], f"tier drift for user {user.pk}"
        assert set(user_effective_permissions(user)) == set(before[user.pk])


def test_g4_employees_intact_and_login_still_200():
    _migrate(back=True)
    apps = MigrationExecutor(connection).loader.project_state(_targets(back=True)).apps
    snapshot = _seed_old_world(apps)
    Employee = apps.get_model("employees", "Employee")
    count_before = Employee.objects.count()

    _migrate(back=False)

    from employees.models import Employee as NewEmployee

    assert NewEmployee.objects.count() == count_before > 0

    from rest_framework.test import APIClient

    alice_pk = next(pk for pk, i in snapshot["users"].items() if i["employee"])
    from accounts.models import User

    alice = User.objects.get(pk=alice_pk)
    client = APIClient()
    resp = client.post(
        "/api/v1/auth/login", {"email": alice.email, "password": "Old-Pass-123!"}
    )
    assert resp.status_code == 200, resp.content[:300]
