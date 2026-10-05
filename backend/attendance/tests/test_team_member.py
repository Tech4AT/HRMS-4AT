"""Individual breaks on a day view, and `/attendance/team/member/<id>`: one person's
day-by-day detail for someone the caller may read in full."""

from datetime import datetime, timedelta, timezone as dt_timezone

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import AttendanceRecord, AttendanceStatus, BreakSession
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

MEMBER = "/api/v1/attendance/team/member"


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _as(role_name, **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, **employee_kwargs)
    return _client_for(user), employee


def _at(day, hour, minute=0):
    return datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc) + timedelta(
        hours=hour, minutes=minute
    )


def _worked_day(employee, day, breaks=((12, 0, 12, 30), (15, 0, 15, 10))):
    record = AttendanceRecord.objects.create(
        employee=employee,
        attendance_date=day,
        clock_in_time=_at(day, 9),
        clock_out_time=_at(day, 18),
        working_minutes=500,
        late_minutes=15,
        overtime_minutes=20,
        status=AttendanceStatus.PRESENT,
    )
    for sh, sm, eh, em in breaks:
        BreakSession.objects.create(
            attendance_record=record, start_time=_at(day, sh, sm), end_time=_at(day, eh, em)
        )
    return record


def _window(days=7):
    today = timezone.localdate()
    return {"from": (today - timedelta(days=days - 1)).isoformat(), "to": today.isoformat()}


def _get(client, employee, **params):
    return client.get(f"{MEMBER}/{employee.pk}", params or _window())


# --- breaks on the day view -----------------------------------------------------------------


def test_the_employees_own_day_lists_each_break_with_start_end_and_minutes():
    client, me = _as("Employee")
    today = timezone.localdate()
    _worked_day(me, today)

    data = client.get("/api/v1/attendance/today").json()["data"]

    assert [(b["minutes"]) for b in data["breaks"]] == [30, 10]
    assert data["breaks"][0]["start"].startswith(f"{today.isoformat()}T12:00")
    assert data["breaks"][0]["end"].startswith(f"{today.isoformat()}T12:30")
    assert data["break_minutes"] == 40  # the existing total is unchanged


def test_a_break_in_progress_has_no_end_and_a_day_without_breaks_has_none():
    client, me = _as("Employee")
    today = timezone.localdate()
    record = _worked_day(me, today, breaks=())
    assert client.get("/api/v1/attendance/today").json()["data"]["breaks"] == []

    BreakSession.objects.create(attendance_record=record, start_time=timezone.now() - timedelta(minutes=5))
    data = client.get("/api/v1/attendance/today").json()["data"]

    assert data["on_break"] is True
    assert data["breaks"][0]["end"] is None and data["breaks"][0]["minutes"] >= 5


# --- the member endpoint --------------------------------------------------------------------


def test_a_manager_sees_a_reports_days_with_times_and_every_break():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)
    today = timezone.localdate()
    _worked_day(report, today)

    response = _get(manager_client, report)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["employee_id"] == str(report.pk) and data["employee_name"]
    assert len(data["rows"]) == 7
    row = next(r for r in data["rows"] if r["attendance_date"] == today.isoformat())
    assert row["check_in"].startswith(f"{today.isoformat()}T09:00")
    assert row["check_out"].startswith(f"{today.isoformat()}T18:00")
    assert (row["working_minutes"], row["late_minutes"], row["overtime_minutes"]) == (500, 15, 20)
    assert [b["minutes"] for b in row["breaks"]] == [30, 10]
    assert {r["employee_id"] for r in data["rows"]} == {str(report.pk)}


def test_hr_can_view_anyone():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()

    assert _get(hr, person).status_code == 200


def test_a_month_can_be_requested():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()

    data = _get(hr, person, month="2026-02").json()["data"]

    assert len(data["rows"]) == 28


def test_a_manager_cannot_view_someone_outside_their_scope():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)
    grandchild = EmployeeFactory(manager=report)  # MANAGER tier is direct reports only
    stranger = EmployeeFactory()
    _worked_day(grandchild, timezone.localdate())

    for target in (grandchild, stranger):
        response = _get(manager_client, target)
        assert response.status_code == 403
        assert "check_in" not in response.content.decode()


def test_an_employee_and_a_peer_get_no_detail_at_all():
    boss = EmployeeFactory()
    client, _ = _as("Employee", manager=boss)
    peer = EmployeeFactory(manager=boss)
    _worked_day(peer, timezone.localdate())

    # They may see that the peer is in (My Team), never the times or breaks.
    summary = client.get("/api/v1/attendance/team/summary", {"group": "peers"}).json()["data"]
    assert summary["members"][0]["presence"] == "in"

    response = _get(client, peer)
    assert response.status_code == 403
    assert "check_in" not in response.content.decode() and "breaks" not in response.content.decode()


def test_nobody_can_view_themselves_through_it_without_the_permission():
    client, me = _as("Employee")

    assert _get(client, me).status_code == 403


def test_a_missing_employee_is_404_and_anonymous_is_401():
    hr, _ = _as("HR Admin")

    assert hr.get(f"{MEMBER}/999999", _window()).status_code == 404
    assert APIClient().get(f"{MEMBER}/1", _window()).status_code == 401


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"from": "2026-03-01"},
        {"from": "2026-03-10", "to": "2026-03-01"},
        {"from": "2026-03-01", "to": "2026-04-05"},  # 36 days
        {"from": "garbage", "to": "2026-03-01"},
        {"month": "nope"},
    ],
)
def test_the_window_is_required_ordered_and_capped(params):
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()

    assert hr.get(f"{MEMBER}/{person.pk}", params).status_code == 400


def test_the_longest_allowed_window_works():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()

    response = _get(hr, person, **{"from": "2026-03-01", "to": "2026-03-31"})

    assert response.status_code == 200 and len(response.json()["data"]["rows"]) == 31
