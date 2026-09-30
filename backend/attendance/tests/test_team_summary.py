"""`/attendance/team/summary` — the My Team read: who is in each group, how much the
caller may see about each person, and that nothing beyond that leaks."""

from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from accounts.models import Role
from attendance.models import AttendanceRecord, AttendanceStatus
from core.enums import ScopeTier
from employees.factories import DepartmentFactory, EmployeeFactory
from leave.models import LeaveBalance, LeaveRequest, LeaveRequestStatus, LeaveType

pytestmark = pytest.mark.django_db

URL = "/api/v1/attendance/team/summary"


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _as(role_name, **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, **employee_kwargs)
    return _client_for(user), employee


def _get(client, group, **params):
    query = "&".join(f"{k}={v}" for k, v in {"group": group, **params}.items())
    return client.get(f"{URL}?{query}")


def _data(client, group, **params):
    response = _get(client, group, **params)
    assert response.status_code == 200, response.content
    return response.json()["data"]


def _ids(data):
    return {m["employee_id"] for m in data["members"]}


def _levels(data):
    return {m["employee_id"]: m["level"] for m in data["members"]}


def _clock_in(employee, day=None, status=AttendanceStatus.PRESENT, late=None):
    day = day or timezone.localdate()
    return AttendanceRecord.objects.create(
        employee=employee,
        attendance_date=day,
        clock_in_time=datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc)
        + timedelta(hours=9),
        status=status,
        late_minutes=late,
    )


def _approved_leave(employee, name="Sick Leave", status=LeaveRequestStatus.APPROVED):
    leave_type = LeaveType.objects.create(name=name, annual_allocation=Decimal("12"))
    today = timezone.localdate()
    LeaveBalance.objects.create(
        employee=employee, leave_type=leave_type, financial_year=str(today.year)
    )
    return LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=today,
        end_date=today,
        duration_days=Decimal("1"),
        financial_year=str(today.year),
        status=status,
    )


# --- access and input --------------------------------------------------------------------


def test_anonymous_is_401():
    assert APIClient().get(f"{URL}?group=direct").status_code == 401


def test_an_account_without_an_employee_record_is_refused():
    user = UserFactory(role=Role.objects.get(name="Employee"))

    assert _get(_client_for(user), "direct").status_code == 403


@pytest.mark.parametrize("group", [None, "", "everyone", "DIRECT"])
def test_the_group_is_required_and_must_be_known(group):
    client, _ = _as("Manager")
    response = client.get(URL) if group is None else _get(client, group)

    assert response.status_code == 400


def test_a_bad_month_is_400():
    client, _ = _as("Manager")

    assert _get(client, "direct", month="nope").status_code == 400


# --- group membership ---------------------------------------------------------------------


def test_direct_reports_are_exactly_the_people_reporting_to_the_caller():
    client, me = _as("Manager")
    report = EmployeeFactory(manager=me)
    grandchild = EmployeeFactory(manager=report)
    stranger = EmployeeFactory(manager=EmployeeFactory())
    exited = EmployeeFactory(manager=me, status="exited")

    data = _data(client, "direct")

    assert _ids(data) == {str(report.pk)}
    assert str(grandchild.pk) not in _ids(data) and str(stranger.pk) not in _ids(data)
    assert str(exited.pk) not in _ids(data) and str(me.pk) not in _ids(data)


def test_indirect_reports_are_everyone_below_the_direct_reports_at_any_depth():
    client, me = _as("Manager")
    report = EmployeeFactory(manager=me)
    child = EmployeeFactory(manager=report)
    grandchild = EmployeeFactory(manager=child)

    data = _data(client, "indirect")

    assert _ids(data) == {str(child.pk), str(grandchild.pk)}


def test_peers_share_the_callers_manager_and_never_include_the_caller():
    boss = EmployeeFactory()
    client, me = _as("Employee", manager=boss)
    sibling_a, sibling_b = EmployeeFactory(manager=boss), EmployeeFactory(manager=boss)
    cousin = EmployeeFactory(manager=EmployeeFactory())

    data = _data(client, "peers")

    assert _ids(data) == {str(sibling_a.pk), str(sibling_b.pk)}
    assert str(me.pk) not in _ids(data) and str(cousin.pk) not in _ids(data)
    assert data["has_manager"] is True


def test_someone_without_a_manager_has_no_peers_and_the_response_says_why():
    client, _ = _as("Employee")
    EmployeeFactory()  # another manager-less person is not a peer

    data = _data(client, "peers")

    assert data["members"] == [] and data["has_manager"] is False
    assert data["coverage"] == {"total": 0, "detail": 0}


def test_a_reporting_cycle_in_the_data_terminates():
    client, me = _as("Manager")
    a, b = EmployeeFactory(manager=me), EmployeeFactory()
    b.manager = a
    b.save()
    a.manager = b  # a <-> b, both under nobody but each other
    a.save()

    assert _get(client, "indirect").status_code == 200


# --- detail versus basic ------------------------------------------------------------------


def test_a_manager_gets_full_detail_for_direct_reports():
    client, me = _as("Manager")
    report = EmployeeFactory(manager=me)
    _approved_leave(report, name="Sick Leave")

    data = _data(client, "direct")

    assert _levels(data) == {str(report.pk): "detail"}
    today_row = next(r for r in data["rows"] if r["attendance_date"] == data["date"])
    assert today_row["status"] == "on_leave" and today_row["leave_type_name"] == "Sick Leave"
    assert data["coverage"] == {"total": 1, "detail": 1}


def test_hr_gets_full_detail_for_their_own_reports():
    hr, me = _as("HR Admin")
    report = EmployeeFactory(manager=me)

    assert _levels(_data(hr, "direct")) == {str(report.pk): "detail"}


def test_a_manager_sees_only_presence_for_indirect_reports_outside_their_scope():
    client, me = _as("Manager")  # attendance.approve at MANAGER tier: direct reports only
    report = EmployeeFactory(manager=me)
    grandchild = EmployeeFactory(manager=report)
    _approved_leave(grandchild, name="Maternity Leave")

    response = _get(client, "indirect")

    data = response.json()["data"]
    assert _levels(data) == {str(grandchild.pk): "basic"}
    assert data["rows"] == []
    assert data["members"][0]["presence"] == "not_in"
    assert data["coverage"] == {"total": 1, "detail": 0}
    assert "Maternity" not in response.content.decode()


def test_an_employee_sees_only_in_or_not_in_for_peers():
    boss = EmployeeFactory()
    client, _ = _as("Employee", manager=boss)
    present = EmployeeFactory(manager=boss)
    away = EmployeeFactory(manager=boss)
    _clock_in(present, late=45)
    _approved_leave(away, name="Sick Leave")

    response = _get(client, "peers")

    data = response.json()["data"]
    presence = {m["employee_id"]: m["presence"] for m in data["members"]}
    assert presence == {str(present.pk): "in", str(away.pk): "not_in"}
    assert set(_levels(data).values()) == {"basic"} and data["rows"] == []
    body = response.content.decode()
    for leaked in ("Sick Leave", "late_minutes", "leave_type_name", "on_leave", "working_minutes"):
        assert leaked not in body, leaked


def test_a_member_only_has_the_minimum_fields_at_basic_level():
    boss = EmployeeFactory()
    client, _ = _as("Employee", manager=boss)
    EmployeeFactory(manager=boss)

    member = _data(client, "peers")["members"][0]

    assert set(member) == {"employee_id", "level", "presence"}


def test_presence_treats_leave_absence_and_not_yet_in_the_same_way():
    boss = EmployeeFactory()
    client, _ = _as("Employee", manager=boss)
    on_leave = EmployeeFactory(manager=boss)
    absent = EmployeeFactory(manager=boss)
    nothing = EmployeeFactory(manager=boss)
    _approved_leave(on_leave)
    AttendanceRecord.objects.create(
        employee=absent, attendance_date=timezone.localdate(), status=AttendanceStatus.ABSENT
    )

    members = _data(client, "peers")["members"]

    assert {m["employee_id"] for m in members} == {str(on_leave.pk), str(absent.pk), str(nothing.pk)}
    assert {m["presence"] for m in members} == {"not_in"}


def test_pending_leave_is_not_shown_until_it_is_approved():
    client, me = _as("Manager")
    report = EmployeeFactory(manager=me)
    leave = _approved_leave(report, status=LeaveRequestStatus.SUBMITTED)

    pending = _data(client, "direct")
    today_row = next(r for r in pending["rows"] if r["attendance_date"] == pending["date"])
    assert today_row["status"] != "on_leave"

    leave.status = LeaveRequestStatus.APPROVED
    leave.save()
    approved = _data(client, "direct")
    today_row = next(r for r in approved["rows"] if r["attendance_date"] == approved["date"])
    assert today_row["status"] == "on_leave"


# --- coherence with the approvals flow ----------------------------------------------------


def _raise_leave_for(report, leave_type):
    """A submitted leave request for today, routed to the report's manager through
    the real approvals engine."""
    from approvals import service as approvals

    today = timezone.localdate()
    row = LeaveRequest.objects.create(
        employee=report,
        leave_type=leave_type,
        start_date=today,
        end_date=today,
        duration_days=Decimal("1"),
        financial_year=str(today.year),
    )
    return approvals.create_request(report.user, "leave", {"leave_request_id": row.pk})


def test_the_team_view_follows_the_approvals_decision_and_never_tells_a_peer_why():
    from approvals import service as approvals
    from approvals.models import RequestStatus

    manager_user = UserFactory(role=Role.objects.get(name="Manager"))
    manager = EmployeeFactory(user=manager_user)
    report = EmployeeFactory(manager=manager)
    peer_user = UserFactory(role=Role.objects.get(name="Employee"))
    peer = EmployeeFactory(user=peer_user, manager=manager)
    leave_type = LeaveType.objects.create(name="Sick Leave", annual_allocation=Decimal("12"))
    LeaveBalance.objects.create(
        employee=report, leave_type=leave_type, financial_year=str(timezone.localdate().year)
    )
    request = _raise_leave_for(report, leave_type)
    manager_client, peer_client = _client_for(manager_user), _client_for(peer_user)

    def today_status():
        data = _data(manager_client, "direct")
        row = next(r for r in data["rows"] if r["attendance_date"] == data["date"])
        return row["status"]

    assert today_status() != "on_leave"  # raised, not decided yet

    approvals.decide(request, manager_user, RequestStatus.APPROVED, "enjoy")
    assert today_status() == "on_leave"

    peer_response = _get(peer_client, "peers")
    peer_view = peer_response.json()["data"]
    assert {m["employee_id"]: m["presence"] for m in peer_view["members"]}[str(report.pk)] == "not_in"
    assert "Sick Leave" not in peer_response.content.decode() and peer_view["rows"] == []
    assert str(peer.pk) not in _ids(peer_view)


def test_a_rejected_leave_request_does_not_show_as_leave():
    from approvals import service as approvals
    from approvals.models import RequestStatus

    manager_user = UserFactory(role=Role.objects.get(name="Manager"))
    manager = EmployeeFactory(user=manager_user)
    report = EmployeeFactory(manager=manager)
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("6"))
    LeaveBalance.objects.create(
        employee=report, leave_type=leave_type, financial_year=str(timezone.localdate().year)
    )
    request = _raise_leave_for(report, leave_type)

    approvals.decide(request, manager_user, RequestStatus.REJECTED, "no cover")

    data = _data(_client_for(manager_user), "direct")
    row = next(r for r in data["rows"] if r["attendance_date"] == data["date"])
    assert row["status"] != "on_leave"


# --- partial coverage ---------------------------------------------------------------------


def test_coverage_reports_partial_detail_when_only_some_of_the_group_is_in_scope():
    engineering, sales = DepartmentFactory(name="Cov Eng"), DepartmentFactory(name="Cov Sales")
    role = RoleFactory(name="Cov department approver")
    RolePermissionFactory(
        role=role, permission=PermissionFactory(code="attendance.approve"), scope_tier=ScopeTier.DEPARTMENT
    )
    user = UserFactory(role=role)
    me = EmployeeFactory(user=user, department=engineering)
    in_scope_1 = EmployeeFactory(manager=me, department=engineering)
    in_scope_2 = EmployeeFactory(manager=me, department=engineering)
    out_of_scope = EmployeeFactory(manager=me, department=sales)

    data = _data(_client_for(user), "direct")

    assert data["coverage"] == {"total": 3, "detail": 2}
    assert _levels(data) == {
        str(in_scope_1.pk): "detail",
        str(in_scope_2.pk): "detail",
        str(out_of_scope.pk): "basic",
    }
    assert {r["employee_id"] for r in data["rows"]} == {str(in_scope_1.pk), str(in_scope_2.pk)}


def test_leave_approve_alone_also_grants_detail_like_the_dashboard():
    role = RoleFactory(name="Cov leave approver")
    RolePermissionFactory(
        role=role, permission=PermissionFactory(code="leave.approve"), scope_tier=ScopeTier.MANAGER
    )
    user = UserFactory(role=role)
    me = EmployeeFactory(user=user)
    report = EmployeeFactory(manager=me)

    assert _levels(_data(_client_for(user), "direct")) == {str(report.pk): "detail"}


# --- window and efficiency ----------------------------------------------------------------


def test_the_requested_month_and_today_are_both_present_for_detail_members():
    client, me = _as("Manager")
    EmployeeFactory(manager=me)

    data = _data(client, "direct", month="2020-01")

    dates = {r["attendance_date"] for r in data["rows"]}
    assert data["month"] == "2020-01" and len(dates) == 31 + 1
    assert data["date"] in dates


def test_the_month_defaults_to_the_current_one():
    client, me = _as("Manager")
    EmployeeFactory(manager=me)

    data = _data(client, "direct")

    today = timezone.localdate()
    assert data["month"] == f"{today.year}-{today.month:02d}"


def _query_count(client, group):
    with CaptureQueriesContext(connection) as queries:
        assert _get(client, group).status_code == 200
    return len(queries)


def test_unrelated_employees_do_not_add_work_to_a_team_view():
    boss = EmployeeFactory()
    client, _ = _as("Employee", manager=boss)
    EmployeeFactory.create_batch(2, manager=boss)
    _get(client, "peers")  # warm caches so counts compare like for like
    baseline = _query_count(client, "peers")

    EmployeeFactory.create_batch(40)  # a whole other company

    assert _query_count(client, "peers") == baseline


def test_an_hr_admin_team_view_does_not_load_the_whole_company():
    hr, me = _as("HR Admin")
    report = EmployeeFactory(manager=me)
    EmployeeFactory.create_batch(15)  # HR's scope is everyone; their team is not

    data = _data(hr, "direct")

    assert _ids(data) == {str(report.pk)}
    assert {r["employee_id"] for r in data["rows"]} == {str(report.pk)}


# --- the Dashboard endpoint is untouched --------------------------------------------------


def test_the_dashboard_endpoint_still_returns_the_whole_scope():
    hr, me = _as("HR Admin")
    other = EmployeeFactory()

    response = hr.get("/api/v1/attendance/team/daily?from=2026-03-01&to=2026-03-01")

    ids = {r["employee_id"] for r in response.json()["data"]}
    assert {str(me.pk), str(other.pk)} <= ids
