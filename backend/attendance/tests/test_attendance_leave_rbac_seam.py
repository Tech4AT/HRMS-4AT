"""Attendance/leave x RBAC/org integration seam (branch test-v1: org + RBAC +
attendance/leave merged).

End-to-end coverage of the attendance/leave boundary with core RBAC scope tiers,
using real Postgres + real DRF API via APIClient — never the live :3000/:3001
stack. Self-seeding: every test builds its own org tree via factories and never
depends on the live dev DB.

Ground truth (read, don't guess): backend/core/permissions.py
(ScopedEmployeePermission), backend/core/scope.py (resolve_employee_scope),
backend/attendance/views.py + api_urls.py + team_views.py,
backend/leave/views.py + api_urls.py, backend/approvals/service.py.

Endpoint map that drives the whole file (verified against the code):
- /api/v1/attendance[?from=&to=|/today|/summary] — caller's OWN history only.
- /api/v1/attendance/requests (list/create) — caller's OWN requests only;
  out-of-scope rows are queryset-invisible (404), not 403 (see group B).
- /api/v1/attendance/requests/approvals/pending|history — scoped by
  attendance.approve (excludes the caller's own rows).
- /api/v1/attendance/team/daily — scoped multi-employee read, union of the
  attendance.approve + leave.approve scopes (active employees only).
- /api/v1/leave/requests, /approvals/pending|history — mirror of the above
  with leave.approve.
- /api/v1/leave/balance, /leave/types (list: any authenticated employee).
- Decisions happen ONLY on the generic /api/v1/requests/{id}/approve|reject;
  AttendanceRequest/LeaveRequest.status is a mirror kept in sync by each app's
  request_decided receiver, which also marks AttendanceRecords / moves
  LeaveBalance pending->used.
"""

from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from rest_framework.test import APIClient

from accounts.factories import (
    PermissionFactory,
    RoleFactory,
    RolePermissionFactory,
    UserFactory,
)
from accounts.models import Permission, Role
from approvals.models import RequestStatus
from attendance.models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceStatus,
)
from core.enums import ScopeTier
from core.registry import is_registered
from core.scope import resolve_employee_scope, user_effective_permissions
from employees.factories import (
    DepartmentFactory,
    EmployeeFactory,
    LegalEntityFactory,
    LocationFactory,
)
from employees.models import BusinessUnit
from leave.models import LeaveBalance, LeaveRequest, LeaveRequestStatus, LeaveType

pytestmark = pytest.mark.django_db

TEAM_DAILY = "/api/v1/attendance/team/daily?from=2026-11-02&to=2026-11-03"
ATT_PENDING = "/api/v1/attendance/requests/approvals/pending"
LEAVE_PENDING = "/api/v1/leave/approvals/pending"
ATT_REQUESTS = "/api/v1/attendance/requests"
LEAVE_REQUESTS = "/api/v1/leave/requests"

# Weekday dates with no holidays/week-offs seeded, so creation-time
# conflicts.py validation passes. Ranges are per-employee disjoint where one
# employee raises more than one request (leave<->attendance overlap rules).
WFH_DATES = ("2026-11-02", "2026-11-03")  # Mon-Tue
REG_DATE = "2026-11-04"  # Wed
LEAVE_DATES = ("2026-11-09", "2026-11-10")  # Mon-Tue, duration 2


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _grant(role, code, tier):
    return RolePermissionFactory(
        role=role, permission=PermissionFactory(code=code), scope_tier=tier
    )


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _seed_org():
    """2 LegalEntities x BusinessUnits x Departments x Locations, ~10
    employees with manager links, so every scope tier is distinguishable."""
    ns = SimpleNamespace()
    ns.le1 = LegalEntityFactory(name="Seam LE One")
    ns.le2 = LegalEntityFactory(name="Seam LE Two")
    ns.bu_consult = BusinessUnit.objects.create(name="Seam Consulting")
    ns.bu_staff = BusinessUnit.objects.create(name="Seam Staffing")
    ns.dept_eng = DepartmentFactory(name="Seam Eng")
    ns.dept_sales = DepartmentFactory(name="Seam Sales")
    ns.loc_hyd = LocationFactory(name="Seam Hyderabad")
    ns.loc_blr = LocationFactory(name="Seam Bengaluru")

    def _emp(department, location, legal_entity, business_unit, manager=None):
        user = UserFactory()
        return user, EmployeeFactory(
            user=user,
            department=department,
            location=location,
            legal_entity=legal_entity,
            business_unit=business_unit,
            manager=manager,
        )

    ns.mgr_user, ns.mgr = _emp(ns.dept_eng, ns.loc_hyd, ns.le1, ns.bu_consult)
    _, ns.direct1 = _emp(ns.dept_eng, ns.loc_hyd, ns.le1, ns.bu_consult, manager=ns.mgr)
    _, ns.indirect1 = _emp(ns.dept_eng, ns.loc_hyd, ns.le1, ns.bu_consult, manager=ns.direct1)
    _, ns.direct2 = _emp(ns.dept_sales, ns.loc_hyd, ns.le1, ns.bu_staff, manager=ns.mgr)
    _, ns.dept_mate = _emp(ns.dept_eng, ns.loc_blr, ns.le1, ns.bu_consult)
    _, ns.loc_mate = _emp(ns.dept_sales, ns.loc_hyd, ns.le1, ns.bu_staff)
    _, ns.le_mate = _emp(ns.dept_sales, ns.loc_blr, ns.le1, ns.bu_staff)
    ns.other_mgr_user, ns.other_mgr = _emp(ns.dept_sales, ns.loc_blr, ns.le2, ns.bu_staff)
    _, ns.outsider = _emp(ns.dept_sales, ns.loc_blr, ns.le2, ns.bu_staff, manager=ns.other_mgr)
    _, ns.outsider_dept = _emp(ns.dept_eng, ns.loc_blr, ns.le2, ns.bu_consult)
    ns.all_ten = [
        ns.mgr,
        ns.direct1,
        ns.indirect1,
        ns.direct2,
        ns.dept_mate,
        ns.loc_mate,
        ns.le_mate,
        ns.other_mgr,
        ns.outsider,
        ns.outsider_dept,
    ]
    return ns


_TIER_ROLE_SEQ = 0


def _tier_role(tier):
    """A custom role granting both approve-scope codes at `tier`. Names carry
    a sequence: RoleFactory get_or_creates on name, so two calls for the same
    tier must not share one (re-granting would violate unique_role_permission)."""
    global _TIER_ROLE_SEQ
    _TIER_ROLE_SEQ += 1
    role = RoleFactory(name=f"Seam {tier} approver {_TIER_ROLE_SEQ}")
    _grant(role, "attendance.approve", tier)
    _grant(role, "leave.approve", tier)
    return role


def _submit_attendance_rows(employees):
    for emp in employees:
        AttendanceRequest.objects.create(
            employee=emp,
            request_type="wfh",
            start_date=WFH_DATES[0],
            end_date=WFH_DATES[1],
            reason="seam",
        )


def _submit_leave_rows(employees, leave_type):
    for emp in employees:
        LeaveRequest.objects.create(
            employee=emp,
            leave_type=leave_type,
            start_date=LEAVE_DATES[0],
            end_date=LEAVE_DATES[1],
            duration_days=2,
            financial_year="2026",
            reason="seam",
        )


def _ids(*employees):
    return {str(e.pk) for e in employees}


# Expected scope sets for the seeded tree's viewer (ns.mgr), per tier.
# other_mgr heads the outside chain (dept_sales/loc_blr/le2, no link to mgr),
# so it joins the scope only at ALL.
def _expected(ns, tier):
    all_ids = _ids(*ns.all_ten)
    me = _ids(ns.mgr)
    if tier == ScopeTier.SELF:
        return me
    if tier == ScopeTier.MANAGER:
        return _ids(ns.mgr, ns.direct1, ns.direct2)
    if tier == ScopeTier.TEAM:
        return _ids(ns.mgr, ns.direct1, ns.direct2, ns.indirect1)
    if tier == ScopeTier.DEPARTMENT:
        # Same department across locations AND legal entities (outsider_dept
        # is in Seam Eng under LE Two); same-LE other-dept rows excluded.
        return _ids(ns.mgr, ns.direct1, ns.indirect1, ns.dept_mate, ns.outsider_dept)
    if tier == ScopeTier.LOCATION:
        return _ids(ns.mgr, ns.direct1, ns.indirect1, ns.direct2, ns.loc_mate)
    if tier == ScopeTier.LEGAL_ENTITY:
        return all_ids - _ids(ns.outsider, ns.outsider_dept, ns.other_mgr)
    if tier == ScopeTier.ALL:
        return all_ids
    raise AssertionError(tier)


# ---------------------------------------------------------------------------
# A. scope-filtered reads across every tier (include AND exclude)
# ---------------------------------------------------------------------------


def _check_tier(tier):
    ns = _seed_org()
    ns.mgr_user.roles.add(_tier_role(tier))
    leave_type = LeaveType.objects.create(name=f"Seam CL {tier}", annual_allocation=12)
    _submit_attendance_rows(ns.all_ten)
    _submit_leave_rows(ns.all_ten, leave_type)

    client = _client(ns.mgr_user)
    in_scope = _expected(ns, tier)

    resp = client.get(TEAM_DAILY)
    assert resp.status_code == 200, resp.content
    seen = {row["employee_id"] for row in resp.json()["data"]}
    assert seen == in_scope

    resp = client.get(ATT_PENDING)
    assert resp.status_code == 200, resp.content
    # Pending queues exclude the viewer's own rows by design.
    assert {row["employee_id"] for row in resp.json()["data"]} == in_scope - _ids(ns.mgr)

    resp = client.get(LEAVE_PENDING)
    assert resp.status_code == 200, resp.content
    assert {row["employee_id"] for row in resp.json()["data"]} == in_scope - _ids(ns.mgr)

    # The resolver itself agrees with all three endpoints.
    assert _ids(*resolve_employee_scope(ns.mgr_user, "attendance.approve")) == in_scope
    assert _ids(*resolve_employee_scope(ns.mgr_user, "leave.approve")) == in_scope


def test_a_self_tier_sees_only_self_everywhere():
    _check_tier(ScopeTier.SELF)


def test_a_manager_tier_covers_direct_reports_only():
    _check_tier(ScopeTier.MANAGER)


def test_a_team_tier_covers_the_transitive_subtree():
    _check_tier(ScopeTier.TEAM)


def test_a_department_tier_crosses_location_and_legal_entity():
    _check_tier(ScopeTier.DEPARTMENT)


def test_a_location_tier_is_narrower_than_department():
    _check_tier(ScopeTier.LOCATION)


def test_a_legal_entity_and_all_tiers():
    ns = _seed_org()
    for tier in (ScopeTier.LEGAL_ENTITY, ScopeTier.ALL):
        ns.mgr_user.roles.add(_tier_role(tier))
        in_scope = _expected(ns, tier)
        assert _ids(*resolve_employee_scope(ns.mgr_user, "attendance.approve")) == in_scope
        ns.mgr_user.roles.remove(*ns.mgr_user.roles.all())
        ns.mgr_user._scope_resolution_cache = {}
    # And through the endpoints at ALL (the broadest tier sees everything).
    ns.mgr_user.roles.add(_tier_role(ScopeTier.ALL))
    ns.mgr_user._scope_resolution_cache = {}
    leave_type = LeaveType.objects.create(name="Seam CL all", annual_allocation=12)
    _submit_attendance_rows(ns.all_ten)
    _submit_leave_rows(ns.all_ten, leave_type)
    client = _client(ns.mgr_user)
    assert {r["employee_id"] for r in client.get(TEAM_DAILY).json()["data"]} == _expected(
        ns, ScopeTier.ALL
    )
    assert {r["employee_id"] for r in client.get(ATT_PENDING).json()["data"]} == _expected(
        ns, ScopeTier.ALL
    ) - _ids(ns.mgr)
    assert {r["employee_id"] for r in client.get(LEAVE_PENDING).json()["data"]} == _expected(
        ns, ScopeTier.ALL
    ) - _ids(ns.mgr)


# ---------------------------------------------------------------------------
# B. write authz
# ---------------------------------------------------------------------------


def test_b_employee_submits_own_wfh_regularisation_and_leave():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=user)
    LeaveType.objects.create(name="Seam Annual", annual_allocation=12)
    client = _client(user)

    wfh = client.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": "2026-11-16",
            "end_date": "2026-11-17",
            "reason": "repairs",
        },
        format="json",
    )
    assert wfh.status_code == 201, wfh.content

    reg = client.post(
        ATT_REQUESTS,
        {"request_type": "regularisation", "start_date": REG_DATE, "reason": "missed punch"},
        format="json",
    )
    assert reg.status_code == 201, reg.content

    leave = client.post(
        LEAVE_REQUESTS,
        {
            "leave_type_id": LeaveType.objects.get(name="Seam Annual").pk,
            "start_date": "2026-11-23",
            "end_date": "2026-11-25",
            "reason": "trip",
        },
        format="json",
    )
    assert leave.status_code == 201, leave.content
    assert leave.json()["data"]["duration_days"] == "3.0"

    assert AttendanceRequest.objects.filter(employee=user.employee).count() == 2
    assert LeaveRequest.objects.filter(employee=user.employee).count() == 1


def test_b_writing_for_someone_outside_scope_is_refused():
    """These views' list querysets are self-only, so someone else's row never
    reaches the object-permission check: the refusal surfaces as 404, not
    403. That is still a denial (the row is invisible AND untouchable), and
    matches the codebase's own convention for these endpoints."""
    me = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=me)
    other = UserFactory(role=Role.objects.get(name="Employee"))
    other_emp = EmployeeFactory(user=other)
    att = AttendanceRequest.objects.create(
        employee=other_emp,
        request_type="wfh",
        start_date="2026-11-02",
        end_date="2026-11-03",
        reason="theirs",
    )
    leave_type = LeaveType.objects.create(name="Seam CL B", annual_allocation=12)
    leave = LeaveRequest.objects.create(
        employee=other_emp,
        leave_type=leave_type,
        start_date=LEAVE_DATES[0],
        end_date=LEAVE_DATES[1],
        duration_days=2,
        financial_year="2026",
    )

    client = _client(me)
    assert (
        client.patch(f"{ATT_REQUESTS}/{att.pk}", {"reason": "hijack"}, format="json").status_code
        == 404
    )
    assert client.post(f"{LEAVE_REQUESTS}/{leave.pk}/cancel").status_code == 404
    assert client.get(f"{ATT_REQUESTS}/{att.pk}").status_code == 404


def test_b_user_without_any_permission_is_403_on_read_and_write():
    stranger = UserFactory()  # no roles, no employee record
    client = _client(stranger)

    assert client.get("/api/v1/attendance?from=2026-11-02&to=2026-11-03").status_code == 403
    assert client.post("/api/v1/attendance/check-in").status_code == 403
    assert client.get(LEAVE_REQUESTS).status_code == 403
    assert client.post(LEAVE_REQUESTS, {"reason": "x"}, format="json").status_code == 403
    assert client.get(TEAM_DAILY).status_code == 403
    assert client.get(ATT_PENDING).status_code == 403


# ---------------------------------------------------------------------------
# C. approvals seam
# ---------------------------------------------------------------------------


def _c_seed():
    """Small tree: mgr with one direct report, plus an outside chain whose
    requests route to a different approver."""
    ns = _seed_org()
    ns.mgr_user.roles.add(Role.objects.get(name="Manager"))
    return ns


def test_c_manager_pending_queue_shows_only_their_scope():
    ns = _c_seed()
    LeaveType.objects.create(name="Seam CL C", annual_allocation=12)
    # Re-wire: give direct1/outsider usable logins via their existing users.
    direct_user = ns.direct1.user
    outsider_user = ns.outsider.user
    mgr_client = _client(ns.mgr_user)

    for u, dates in ((direct_user, ("2026-11-02", "2026-11-03")),):
        c = _client(u)
        r = c.post(
            ATT_REQUESTS,
            {"request_type": "wfh", "start_date": dates[0], "end_date": dates[1], "reason": "c"},
            format="json",
        )
        assert r.status_code == 201, r.content
    c = _client(outsider_user)
    r = c.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": "2026-11-16",
            "end_date": "2026-11-17",
            "reason": "c",
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    # The viewer themselves also submits — their own row must NOT queue.
    r = mgr_client.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": "2026-11-18",
            "end_date": "2026-11-18",
            "reason": "mine",
        },
        format="json",
    )
    assert r.status_code == 201, r.content

    pending = mgr_client.get(ATT_PENDING).json()["data"]
    assert {row["employee_id"] for row in pending} == {str(ns.direct1.pk)}

    # Same boundary for leave.
    lt_id = LeaveType.objects.get(name="Seam CL C").pk
    assert (
        _client(direct_user)
        .post(
            LEAVE_REQUESTS,
            {
                "leave_type_id": lt_id,
                "start_date": "2026-11-09",
                "end_date": "2026-11-10",
                "reason": "c",
            },
            format="json",
        )
        .status_code
        == 201
    )
    assert (
        c.post(
            LEAVE_REQUESTS,
            {
                "leave_type_id": lt_id,
                "start_date": "2026-11-23",
                "end_date": "2026-11-24",
                "reason": "c",
            },
            format="json",
        ).status_code
        == 201
    )
    pending = mgr_client.get(LEAVE_PENDING).json()["data"]
    assert {row["employee_id"] for row in pending} == {str(ns.direct1.pk)}

    # And the team/daily read matches the MANAGER tier exactly.
    seen = {row["employee_id"] for row in mgr_client.get(TEAM_DAILY).json()["data"]}
    assert seen == _ids(ns.mgr, ns.direct1, ns.direct2)


def test_c_engine_approval_flips_the_mirror_and_marks_the_record():
    ns = _c_seed()
    direct_client = _client(ns.direct1.user)
    mgr_client = _client(ns.mgr_user)

    created = direct_client.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": WFH_DATES[0],
            "end_date": WFH_DATES[1],
            "reason": "c2",
        },
        format="json",
    )
    assert created.status_code == 201, created.content

    item = mgr_client.get(ATT_PENDING).json()["data"][0]
    assert item["employee_id"] == str(ns.direct1.pk)
    approval_id = item["approval_request_id"]

    decided = mgr_client.post(
        f"/api/v1/requests/{approval_id}/approve", {"note": "ok"}, format="json"
    )
    assert decided.status_code == 200, decided.content
    assert decided.json()["data"]["status"] == RequestStatus.APPROVED

    row = AttendanceRequest.objects.get(employee=ns.direct1)
    assert row.status == AttendanceRequestStatus.APPROVED
    records = AttendanceRecord.objects.filter(employee=ns.direct1).order_by("attendance_date")
    assert [r.attendance_date.isoformat() for r in records] == list(WFH_DATES)
    assert all(r.status == AttendanceStatus.WORK_FROM_HOME for r in records)


def test_c_request_from_outside_scope_is_undecidable():
    ns = _c_seed()
    direct_client = _client(ns.direct1.user)
    created = direct_client.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": WFH_DATES[0],
            "end_date": WFH_DATES[1],
            "reason": "c3",
        },
        format="json",
    )
    approval_id = created.json()["data"]["approval_request_id"]

    # The named approver is ns.mgr_user; anyone else is refused by the engine.
    # The outsider-manager holds a real MANAGER approve grant, so their queue
    # itself is reachable (200) — the foreign request is still absent from it.
    ns.other_mgr_user.roles.add(Role.objects.get(name="Manager"))
    other_client = _client(ns.other_mgr_user)
    denied = other_client.post(
        f"/api/v1/requests/{approval_id}/approve", {"note": "x"}, format="json"
    )
    assert denied.status_code == 403, denied.content

    row = AttendanceRequest.objects.get(employee=ns.direct1)
    assert row.status == AttendanceRequestStatus.SUBMITTED
    # And it never appears in the outsider-manager's queue either.
    assert other_client.get(ATT_PENDING).json()["data"] == []


def test_c_leave_approval_moves_pending_to_used_on_the_right_balance():
    from decimal import Decimal

    ns = _c_seed()
    leave_type = LeaveType.objects.create(name="Seam CL C4", annual_allocation=12)
    # A decoy balance that must stay untouched.
    decoy = LeaveBalance.objects.create(
        employee=ns.le_mate,
        leave_type=leave_type,
        financial_year="2026",
        allocated=12,
        used=1,
        pending=0,
    )

    direct_client = _client(ns.direct1.user)
    created = direct_client.post(
        LEAVE_REQUESTS,
        {
            "leave_type_id": leave_type.pk,
            "start_date": "2026-11-09",
            "end_date": "2026-11-11",
            "reason": "trip",
        },
        format="json",
    )
    assert created.status_code == 201, created.content

    balance = LeaveBalance.objects.get(
        employee=ns.direct1, leave_type=leave_type, financial_year="2026"
    )
    assert balance.pending == Decimal("3") and balance.used == Decimal("0")

    mgr_client = _client(ns.mgr_user)
    approval_id = mgr_client.get(LEAVE_PENDING).json()["data"][0]["approval_request_id"]
    decided = mgr_client.post(
        f"/api/v1/requests/{approval_id}/approve", {"note": "enjoy"}, format="json"
    )
    assert decided.status_code == 200, decided.content

    row = LeaveRequest.objects.get(employee=ns.direct1)
    assert row.status == LeaveRequestStatus.APPROVED
    balance.refresh_from_db()
    assert balance.used == Decimal("3") and balance.pending == Decimal("0")
    decoy.refresh_from_db()
    assert decoy.used == Decimal("1") and decoy.pending == Decimal("0")


# ---------------------------------------------------------------------------
# D. self-service baseline
# ---------------------------------------------------------------------------


def test_d_every_employee_reads_only_their_own_data():
    me = UserFactory(role=Role.objects.get(name="Employee"))
    me_emp = EmployeeFactory(user=me)
    other = UserFactory(role=Role.objects.get(name="Employee"))
    other_emp = EmployeeFactory(user=other)
    LeaveType.objects.create(name="Seam CL D", annual_allocation=12)
    AttendanceRequest.objects.create(
        employee=me_emp,
        request_type="wfh",
        start_date="2026-11-02",
        end_date="2026-11-03",
        reason="mine",
    )
    AttendanceRequest.objects.create(
        employee=other_emp,
        request_type="wfh",
        start_date="2026-11-02",
        end_date="2026-11-03",
        reason="theirs",
    )

    client = _client(me)
    assert client.get("/api/v1/attendance?from=2026-11-02&to=2026-11-03").status_code == 200
    assert client.get("/api/v1/attendance/today").status_code == 200
    assert client.get("/api/v1/attendance/summary?from=2026-11-02&to=2026-11-03").status_code == 200

    balances = client.get("/api/v1/leave/balance")
    assert balances.status_code == 200 and balances.json()["data"]

    own = client.get(ATT_REQUESTS).json()["data"]
    assert {row["employee_id"] for row in own} == {str(me_emp.pk)}
    own_leave = client.get(LEAVE_REQUESTS).json()["data"]
    assert all(row["employee_id"] == str(me_emp.pk) for row in own_leave)


def test_d_every_employee_cancels_only_their_own_requests():
    me = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=me)
    other = UserFactory(role=Role.objects.get(name="Employee"))
    other_emp = EmployeeFactory(user=other)
    LeaveType.objects.create(name="Seam CL D2", annual_allocation=12)

    client = _client(me)
    wfh = client.post(
        ATT_REQUESTS,
        {
            "request_type": "wfh",
            "start_date": "2026-11-16",
            "end_date": "2026-11-17",
            "reason": "mine",
        },
        format="json",
    ).json()["data"]
    leave = client.post(
        LEAVE_REQUESTS,
        {
            "leave_type_id": LeaveType.objects.get(name="Seam CL D2").pk,
            "start_date": "2026-11-23",
            "end_date": "2026-11-24",
            "reason": "mine",
        },
        format="json",
    ).json()["data"]

    assert client.post(f"{ATT_REQUESTS}/{wfh['id']}/cancel").status_code == 200
    assert AttendanceRequest.objects.get(pk=wfh["id"]).status == AttendanceRequestStatus.CANCELLED
    assert client.post(f"{LEAVE_REQUESTS}/{leave['id']}/cancel").status_code == 200
    assert LeaveRequest.objects.get(pk=leave["id"]).status == LeaveRequestStatus.CANCELLED

    # Cancelling twice is a 400 (only pending rows can be cancelled).
    assert client.post(f"{ATT_REQUESTS}/{wfh['id']}/cancel").status_code == 400

    # Someone else's pending row is invisible to me (404, same convention as B).
    theirs = AttendanceRequest.objects.create(
        employee=other_emp,
        request_type="wfh",
        start_date="2026-11-02",
        end_date="2026-11-03",
        reason="theirs",
    )
    assert client.post(f"{ATT_REQUESTS}/{theirs.pk}/cancel").status_code == 404


# ---------------------------------------------------------------------------
# E. permission catalog + multi-role + settings gate
# ---------------------------------------------------------------------------


def test_e_attendance_leave_codes_are_registered_and_synced():
    for code in (
        "attendance.read",
        "attendance.write",
        "attendance.approve",
        "leave.read",
        "leave.write",
        "attendance.settings.manage",
    ):
        assert is_registered(code), code
        assert Permission.objects.filter(code=code).exists(), code


def test_e_two_roles_grant_the_union_of_attendance_and_leave():
    dept = DepartmentFactory(name="Seam E Eng")
    loc = LocationFactory(name="Seam E Hyd")
    r_att = RoleFactory(name="Seam E attendance")
    _grant(r_att, "attendance.read", ScopeTier.DEPARTMENT)
    r_leave = RoleFactory(name="Seam E leave")
    _grant(r_leave, "leave.read", ScopeTier.LOCATION)
    _grant(r_leave, "leave.write", ScopeTier.SELF)

    user = UserFactory()
    user.roles.add(r_att, r_leave)
    mine = EmployeeFactory(user=user, department=dept, location=loc)
    dept_colleague = EmployeeFactory(department=dept, location=LocationFactory())
    loc_colleague = EmployeeFactory(department=DepartmentFactory(), location=loc)

    effective = user_effective_permissions(user)
    assert {"attendance.read", "leave.read", "leave.write"} <= effective

    assert set(resolve_employee_scope(user, "attendance.read").values_list("pk", flat=True)) == {
        mine.pk,
        dept_colleague.pk,
    }
    assert set(resolve_employee_scope(user, "leave.read").values_list("pk", flat=True)) == {
        mine.pk,
        loc_colleague.pk,
    }


_POLICY_PAYLOAD = {
    "regularisationGraceDays": 5,
    "abscondingThresholdDays": 7,
    "penaltyLeaveTypeId": None,
    "noAttendance": {"enabled": True, "leaveDaysDeducted": 1},
    "lateArrival": {"enabled": True, "leaveDaysDeducted": 0.5, "thresholdCount": 4},
    "earlyLeaving": {"enabled": False, "leaveDaysDeducted": 0.5, "thresholdCount": 3},
    "workHours": {"enabled": False, "leaveDaysDeducted": 0.5, "minWorkHours": 8},
}


def _role_client(name):
    user = UserFactory(role=Role.objects.get(name=name))
    EmployeeFactory(user=user)
    return _client(user)


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_e_settings_endpoints_refuse_callers_without_the_manage_code(role):
    client = _role_client(role)
    assert client.get("/api/v1/attendance/policy-settings").status_code == 403
    assert (
        client.put("/api/v1/attendance/policy-settings", _POLICY_PAYLOAD, format="json").status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/attendance/shifts",
            {"name": f"Seam {role}", "startTime": "09:00", "endTime": "18:00"},
            format="json",
        ).status_code
        == 403
    )


def test_e_settings_endpoints_serve_the_manage_holder():
    client = _role_client("HR Admin")
    assert client.get("/api/v1/attendance/policy-settings").status_code == 200
    put = client.put("/api/v1/attendance/policy-settings", _POLICY_PAYLOAD, format="json")
    assert put.status_code == 200, put.content
    created = client.post(
        "/api/v1/attendance/shifts",
        {"name": "Seam Day", "startTime": "09:00", "endTime": "18:00", "breakMinutes": 60},
        format="json",
    )
    assert created.status_code == 201, created.content


# ---------------------------------------------------------------------------
# F. merged-graph smoke only (tara verified the full graph)
# ---------------------------------------------------------------------------


def test_f_merged_migration_graph_applies_and_apps_are_installed():
    for label in ("attendance", "leave", "approvals"):
        assert apps.is_installed(label), label
    loader = MigrationLoader(connection)
    loader.check_consistent_history(connection)
