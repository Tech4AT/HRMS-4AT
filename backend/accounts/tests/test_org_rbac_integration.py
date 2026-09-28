"""Org x RBAC integration seam (branch test-v1: organization + RBAC on main).

End-to-end coverage of the RBAC-core x organization boundary with real
Postgres + real DRF API via APIClient: role assignment through the admin API,
scope-tier resolution against real Employee/Department/Location rows,
multi-role union, RBAC enforcement on org endpoints, admin-users pagination,
and the pinned demo-logins seed. Self-seeding: every test builds its own
fixtures via factories (or a synthetic xlsx for the seed test) and never
depends on the live dev DB.
"""

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from accounts.factories import (
    PermissionFactory,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
)
from accounts.management.commands.load_real_directory import ADMIN_EMAIL, ADMIN_PW, DEMO_PW
from accounts.models import Role, RolePermission, User
from core.enums import ScopeTier
from core.scope import (
    baseline_self_permissions,
    resolve_employee_scope,
    user_effective_permissions,
)
from employees.factories import DepartmentFactory, EmployeeFactory, LocationFactory
from employees.models import Department, Employee

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _admin_client(role_name="HR Admin"):
    """An authenticated client whose caller holds roles.manage (via a real
    starter role, whose grants come from migration 0002 + post-migrate sync,
    exactly as in production)."""
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _grant(role, code, tier):
    return RolePermissionFactory(
        role=role, permission=PermissionFactory(code=code), scope_tier=tier
    )


def _user_in_dept(role, department, location=None, **fields):
    user = UserFactory(role=role, **fields)
    employee = EmployeeFactory(user=user, department=department, location=location)
    return user, employee


# ---------------------------------------------------------------------------
# (a) role assignment via admin API grants exactly that role's permissions
# ---------------------------------------------------------------------------


def test_a_assigning_role_grants_exactly_its_permissions_at_tier():
    client, _ = _admin_client()
    role = RoleFactory(name="A Dept Writer")
    _grant(role, "employees.write", ScopeTier.ALL)
    _grant(role, "orgchanges.write", ScopeTier.DEPARTMENT)

    target = UserFactory(role=None)
    EmployeeFactory(user=target)

    resp = client.patch(
        f"/api/v1/users/{target.pk}/", {"roleIds": [role.pk]}, format="json"
    )
    assert resp.status_code == 200, resp.content
    assert {r["name"] for r in resp.json()["roles"]} == {"A Dept Writer"}

    target = User.objects.get(pk=target.pk)
    expected = set(baseline_self_permissions()) | {"employees.write", "orgchanges.write"}
    assert user_effective_permissions(target) == expected

    # employees.write is outside the self-service baseline, so the ONLY way
    # the target holds it is through the just-assigned role.
    assert target.roles.filter(pk=role.pk).exists()


def test_a_patch_grant_scope_tier_is_reflected_in_resolution():
    client, _ = _admin_client()
    dept = DepartmentFactory(name="A Dept")
    other_dept = DepartmentFactory(name="A Other Dept")
    role = RoleFactory(name="A Scoped")
    grant = _grant(role, "orgchanges.write", ScopeTier.DEPARTMENT)

    holder, _ = _user_in_dept(role, dept)
    EmployeeFactory(department=dept)
    EmployeeFactory(department=other_dept)

    preview = client.get(
        f"/api/v1/users/{holder.pk}/access-preview/", {"permission": "orgchanges.write"}
    )
    assert preview.json()["data"]["tier"] == ScopeTier.DEPARTMENT
    assert preview.json()["data"]["reachCount"] == 2  # holder + same-dept colleague

    # NOTE: trailing slash required (APPEND_SLASH=True); the write URL ends in '/'.
    resp = client.patch(
        f"/api/v1/role-permissions/{grant.pk}/", {"scopeTier": ScopeTier.ALL}, format="json"
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["scopeTier"] == ScopeTier.ALL

    holder = User.objects.get(pk=holder.pk)
    assert resolve_employee_scope(holder, "orgchanges.write").count() == Employee.objects.count()
    preview = client.get(
        f"/api/v1/users/{holder.pk}/access-preview/", {"permission": "orgchanges.write"}
    )
    assert preview.json()["data"]["tier"] == ScopeTier.ALL


# ---------------------------------------------------------------------------
# (b) scope resolution across the org structure against real rows
# ---------------------------------------------------------------------------


def test_b_department_scope_covers_dept_across_locations_not_outside():
    dept = DepartmentFactory(name="B Eng")
    other = DepartmentFactory(name="B Sales")
    loc_a = LocationFactory(name="B Loc A")
    loc_b = LocationFactory(name="B Loc B")
    role = RoleFactory(name="B Dept Reader")
    _grant(role, "employees.read", ScopeTier.DEPARTMENT)

    holder, holder_emp = _user_in_dept(role, dept, loc_a)
    _, same_dept_same_loc = _user_in_dept(RoleFactory(name="B x1"), dept, loc_a)
    _, same_dept_other_loc = _user_in_dept(RoleFactory(name="B x2"), dept, loc_b)
    _, outsider = _user_in_dept(RoleFactory(name="B x3"), other, loc_a)

    in_scope = set(
        resolve_employee_scope(holder, "employees.read").values_list("pk", flat=True)
    )
    assert in_scope == {holder_emp.pk, same_dept_same_loc.pk, same_dept_other_loc.pk}
    assert outsider.pk not in in_scope

    # Same boundary through the real list endpoint.
    client = APIClient()
    client.force_authenticate(user=holder)
    data = client.get("/api/v1/employees/").json()["data"]
    seen = {row["id"] for row in data}
    assert str(holder_emp.pk) in seen
    assert str(same_dept_other_loc.pk) in seen  # same dept, other location: visible
    assert str(outsider.pk) not in seen


def test_b_location_scope_is_narrower_than_department():
    dept = DepartmentFactory(name="B2 Eng")
    loc_a = LocationFactory(name="B2 Loc A")
    loc_b = LocationFactory(name="B2 Loc B")
    role = RoleFactory(name="B2 Loc Reader")
    _grant(role, "employees.read", ScopeTier.LOCATION)

    holder, holder_emp = _user_in_dept(role, dept, loc_a)
    _, same_loc = _user_in_dept(RoleFactory(name="B2 x1"), dept, loc_a)
    _, other_loc = _user_in_dept(RoleFactory(name="B2 x2"), dept, loc_b)

    in_scope = set(
        resolve_employee_scope(holder, "employees.read").values_list("pk", flat=True)
    )
    assert in_scope == {holder_emp.pk, same_loc.pk}
    assert other_loc.pk not in in_scope


def test_b_manager_scope_covers_direct_reports_only():
    role = RoleFactory(name="B3 Mgr")
    _grant(role, "employees.read", ScopeTier.MANAGER)
    boss = UserFactory(role=role)
    boss_emp = EmployeeFactory(user=boss)
    _, report = _user_in_dept(RoleFactory(name="B3 x1"), DepartmentFactory(name="B3 D"))
    report.manager = boss_emp
    report.save()
    _, stranger = _user_in_dept(RoleFactory(name="B3 x2"), DepartmentFactory(name="B3 D2"))

    in_scope = set(
        resolve_employee_scope(boss, "employees.read").values_list("pk", flat=True)
    )
    assert in_scope == {boss_emp.pk, report.pk}
    assert stranger.pk not in in_scope


def test_b_roleless_employee_sees_only_self_in_directory():
    me = UserFactory(role=None)
    me_emp = EmployeeFactory(user=me)
    other_emp = EmployeeFactory()  # baseline SELF: me must not see this row

    assert set(
        resolve_employee_scope(me, "employees.read").values_list("pk", flat=True)
    ) == {me_emp.pk}

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get("/api/v1/employees/")
    assert resp.status_code == 200
    assert [row["id"] for row in resp.json()["data"]] == [str(me_emp.pk)]
    assert str(other_emp.pk) not in resp.content.decode()


# ---------------------------------------------------------------------------
# (c) multi-role union
# ---------------------------------------------------------------------------


def test_c_two_roles_grant_the_union_with_broadest_tier():
    dept = DepartmentFactory(name="C Eng")
    loc = LocationFactory(name="C Loc")
    other_loc = LocationFactory(name="C Other Loc")
    r1 = RoleFactory(name="C R1")
    _grant(r1, "employees.read", ScopeTier.DEPARTMENT)
    _grant(r1, "orgchanges.write", ScopeTier.ALL)
    r2 = RoleFactory(name="C R2")
    _grant(r2, "employees.read", ScopeTier.LOCATION)
    _grant(r2, "payroll.read", ScopeTier.ALL)

    user = UserFactory()
    user.roles.add(r1, r2)
    EmployeeFactory(user=user, department=dept, location=loc)
    EmployeeFactory(department=dept, location=loc)
    EmployeeFactory(department=dept, location=other_loc)

    effective = user_effective_permissions(user)
    assert {"employees.read", "orgchanges.write", "payroll.read"} <= effective

    # Same code on both roles: the BROADEST tier wins. The tier order is
    # SELF < MANAGER < TEAM < DEPARTMENT < LOCATION < LEGAL_ENTITY < ALL,
    # so LOCATION outranks DEPARTMENT here — and the reach follows it:
    # same-location colleagues only, not the whole department.
    client, _ = _admin_client()
    data = client.get(
        f"/api/v1/users/{user.pk}/access-preview/", {"permission": "employees.read"}
    ).json()["data"]
    assert data["granted"] is True
    assert data["tier"] == ScopeTier.LOCATION
    assert data["source"] == "role"
    assert data["reachCount"] == 2


# ---------------------------------------------------------------------------
# (d) org endpoints enforce RBAC
# ---------------------------------------------------------------------------


def _stranger_client():
    """Authenticated but holds nothing: no roles, no employee record."""
    user = UserFactory(role=None)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_d_employees_endpoints_unauthorized_403_authorized_200():
    EmployeeFactory()
    stranger = _stranger_client()

    assert stranger.get("/api/v1/employees/").status_code == 403

    client, _ = _admin_client()
    resp = client.get("/api/v1/employees/")
    assert resp.status_code == 200
    assert resp.json()["data"]  # HR Admin (ALL) sees the directory

    # Retrieve on an out-of-scope employee is an explicit 403, not a 404.
    me = UserFactory(role=Role.objects.get(name="Employee"))
    me_emp = EmployeeFactory(user=me)
    other_emp = EmployeeFactory()
    self_client = APIClient()
    self_client.force_authenticate(user=me)
    assert self_client.get(f"/api/v1/employees/{me_emp.pk}/").status_code == 200
    assert self_client.get(f"/api/v1/employees/{other_emp.pk}/").status_code == 403


def test_d_org_changes_endpoints_enforce_rbac_end_to_end():
    from datetime import date

    from orgchanges.models import OrgChange

    dept = DepartmentFactory(name="D Eng")
    target_user = UserFactory()
    target = EmployeeFactory(user=target_user, department=dept)

    stranger = _stranger_client()
    assert stranger.get("/api/v1/org-changes/").status_code == 403

    client, hr = _admin_client()
    assert client.get("/api/v1/org-changes/").status_code == 200

    # A SELF-tier employee cannot raise a change for someone else.
    me = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=me)
    self_client = APIClient()
    self_client.force_authenticate(user=me)
    payload = {
        "employee_id": target.pk,
        "change_type": OrgChange.TYPE_DEPT_TRANSFER,
        "to_data": {"department_id": dept.pk},
        "effective_date": str(date.today()),
    }
    denied = self_client.post("/api/v1/org-changes/", payload, format="json")
    assert denied.status_code == 403, denied.content

    # HR Admin (orgchanges.write @ ALL) raises, then cancels, a change.
    created = client.post("/api/v1/org-changes/", payload, format="json")
    assert created.status_code == 201, created.content
    change_id = created.json()["data"]["id"]

    listed = client.get("/api/v1/org-changes/").json()["data"]
    assert change_id in {row["id"] for row in listed}

    cancelled = client.patch(
        f"/api/v1/org-changes/{change_id}/", {"status": "cancelled"}, format="json"
    )
    assert cancelled.status_code == 200, cancelled.content
    assert cancelled.json()["data"]["status"] == "cancelled"


def test_d_org_structure_admin_endpoints_require_org_manage():
    assert _stranger_client().get("/api/v1/org/departments/").status_code == 403

    client, _ = _admin_client()
    resp = client.get("/api/v1/org/departments/")
    assert resp.status_code == 200
    # A SELF-tier employee (no org.manage) is also refused.
    me = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=me)
    self_client = APIClient()
    self_client.force_authenticate(user=me)
    assert self_client.get("/api/v1/org/departments/").status_code == 403


# ---------------------------------------------------------------------------
# (e) admin users pagination past the old 100 cap
# ---------------------------------------------------------------------------


def test_e_users_list_returns_full_directory_with_page_size_1000():
    client, _ = _admin_client()
    # 105 users: past the old max_page_size=100 cap that used to truncate the
    # role pickers (Tejas Vetukuri sat at rank ~129/147 in production).
    emails = []
    for n in range(105):
        u = UserFactory(username=f"pag{1000 + n}", email=f"pag{1000 + n}@example.com")
        EmployeeFactory(user=u)
        emails.append(u.email)

    resp = client.get("/api/v1/users/", {"pageSize": 1000})
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["total"] == User.objects.count()
    assert len(body["results"]) == body["total"]
    assert body["pageSize"] == 1000
    returned = {row["email"] for row in body["results"]}
    assert set(emails) <= returned
    # The tail of the directory (past row 100) is present.
    assert emails[-1] in returned


# ---------------------------------------------------------------------------
# (f) seed pins exactly the 5 demo logins with the correct roles
# ---------------------------------------------------------------------------


def _synthetic_roster(path, rows):
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(
        [
            "Employee Number",
            "First Name",
            "Last Name",
            "Department",
            "Sub Department",
            "Job Title",
            "Location",
            "Exit Status",
            "Reporting Manager",
        ]
    )
    for row in rows:
        ws.append(row)
    wb.save(path)


PINNED = [
    ("4AT0111", "HR Admin"),
    ("4AT0181", "Employee"),
    ("4AT0187", "Manager"),
    ("4AT0070", "Finance"),
]


def test_f_seed_yields_exactly_the_five_pinned_logins(tmp_path):
    rows = [
        (empno, f"First{empno}", f"Last{empno}", "Engineering", "", "Engineer", "Hyderabad", "", "")
        for empno, _ in PINNED
    ]
    rows += [
        ("4AT9991", "Extra", "One", "Engineering", "", "Engineer", "Hyderabad", "", ""),
        ("4AT9992", "Extra", "Two", "Sales", "", "Rep", "Hyderabad", "", ""),
    ]
    xlsx = tmp_path / "roster.xlsx"
    _synthetic_roster(xlsx, rows)

    call_command("load_real_directory", str(xlsx))

    assert Employee.objects.count() == len(rows)

    expected_roles = {ADMIN_EMAIL: "HR Admin"}
    expected_roles.update({f"{empno.lower()}@consult-4at.com": role for empno, role in PINNED})

    usable = [u for u in User.objects.all() if u.has_usable_password()]
    assert {u.email for u in usable} == set(expected_roles)

    admin = User.objects.get(email=ADMIN_EMAIL)
    assert admin.is_superuser and admin.check_password(ADMIN_PW)
    assert set(admin.roles.values_list("name", flat=True)) == {"HR Admin"}

    for email, role_name in expected_roles.items():
        if email == ADMIN_EMAIL:
            continue
        user = User.objects.get(email=email)
        assert user.check_password(DEMO_PW), email
        assert set(user.roles.values_list("name", flat=True)) == {role_name}, email

    # Everyone else stays in the directory with an unusable password and no roles.
    for user in User.objects.exclude(email__in=expected_roles):
        assert not user.has_usable_password(), user.email
        assert user.roles.count() == 0, user.email
