"""ORG Wave 1: Team, Job Architecture (JobFamily/Level/Grade/Position) and the
additive Employee position/level/grade FKs."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import (
    Department,
    JobTitle,
    Employee,
    Grade,
    JobFamily,
    Level,
    Position,
    Team,
)

pytestmark = pytest.mark.django_db


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _admin_url(kind, pk=None):
    return f"/api/v1/org/{kind}/" + (f"{pk}/" if pk else "")


# --- Team --------------------------------------------------------------------


def test_hr_manages_teams_and_every_write_is_audited():
    hr = _client("HR Admin")
    dept = DepartmentFactory(name="Platform")

    created = hr.post(
        _admin_url("teams"), {"name": "Checkout", "department": dept.pk}, format="json"
    )
    assert created.status_code == 201
    body = created.json()
    assert body["departmentName"] == "Platform" and body["leadName"] is None
    pk = body["id"]

    renamed = hr.patch(_admin_url("teams", pk), {"name": "Checkout Pod"}, format="json")
    assert renamed.status_code == 200 and renamed.json()["name"] == "Checkout Pod"

    assert hr.delete(_admin_url("teams", pk)).status_code == 204
    assert not Team.objects.filter(pk=pk).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"Team.created", "Team.updated", "Team.deleted"} <= actions


def test_teams_read_list_is_snake_case_and_scoped_like_the_directory():
    dept = DepartmentFactory(name="Platform")
    lead = EmployeeFactory()
    Team.objects.create(name="Checkout", department=dept, lead=lead)

    body = _client("Employee").get("/api/v1/teams/").json()

    assert body["success"] is True
    row = next(r for r in body["data"] if r["name"] == "Checkout")
    assert row["department_id"] == str(dept.pk) and row["lead_id"] == str(lead.pk)


def test_only_org_manage_holders_touch_team_admin():
    client = _client("Employee")

    assert client.get(_admin_url("teams")).status_code == 403
    assert client.post(_admin_url("teams"), {"name": "X"}, format="json").status_code == 403


# --- Job Architecture ----------------------------------------------------------


def test_hr_manages_job_families_levels_grades_and_positions():
    hr = _client("HR Admin")

    family = hr.post(_admin_url("job-families"), {"name": "Test Family"}, format="json")
    assert family.status_code == 201 and JobFamily.objects.filter(name="Test Family").exists()

    level = hr.post(_admin_url("levels"), {"name": "T3 · Senior"}, format="json")
    assert level.status_code == 201
    assert level.json()["positionCount"] == 0

    grade = hr.post(_admin_url("grades"), {"name": "TG3"}, format="json")
    assert grade.status_code == 201

    dept = DepartmentFactory(name="Platform")
    title = JobTitle.objects.create(name="Backend Engineer")
    seat = hr.post(
        _admin_url("positions"),
        {
            "name": "Platform — Backend Engineer",
            "department": dept.pk,
            "jobTitle": title.pk,
            "level": level.json()["id"],
            "grade": grade.json()["id"],
        },
        format="json",
    )
    assert seat.status_code == 201
    assert seat.json()["status"] == "vacant"
    assert seat.json()["levelName"] == "T3 · Senior"

    assert hr.delete(_admin_url("positions", seat.json()["id"])).status_code == 204
    assert not Position.objects.exists()


def test_a_level_or_grade_with_seats_cannot_be_deleted():
    hr = _client("HR Admin")
    level = Level.objects.create(name="T4 · Lead")
    Position.objects.create(name="Seat", level=level)

    response = hr.delete(_admin_url("levels", level.pk))

    assert response.status_code == 409
    assert "deactivate" in response.json()["error"]["message"]
    assert Level.objects.filter(pk=level.pk).exists()


def test_a_position_cannot_report_to_itself_or_its_subordinate():
    hr = _client("HR Admin")
    top = Position.objects.create(name="Top")
    bottom = Position.objects.create(name="Bottom", reports_to=top)

    assert (
        hr.patch(_admin_url("positions", top.pk), {"reportsTo": top.pk}, format="json").status_code
        == 400
    )
    response = hr.patch(_admin_url("positions", top.pk), {"reportsTo": bottom.pk}, format="json")
    assert response.status_code == 400
    top.refresh_from_db()
    assert top.reports_to_id is None


def test_job_arch_read_lists_are_snake_case_frontend_shape():
    Level.objects.create(name="T1 · Associate")
    Grade.objects.create(name="TG0", is_active=False)
    Position.objects.create(name="Open Seat", status="hiring")

    client = _client("Employee")
    levels = client.get("/api/v1/levels/").json()
    assert levels["success"] is True and "T1 · Associate" in [r["name"] for r in levels["data"]]

    grades = client.get("/api/v1/grades/").json()
    names = [r["name"] for r in grades["data"]]
    assert "TG0" not in names and "G1" in names  # inactive hidden, seeded actives shown

    seats = client.get("/api/v1/positions/").json()
    row = next(r for r in seats["data"] if r["name"] == "Open Seat")
    assert row["status"] == "hiring" and row["incumbent_id"] is None


# --- Employee additive FKs -----------------------------------------------------


def test_employee_write_accepts_position_level_grade_and_read_returns_them():
    hr = _client("HR Admin")
    level = Level.objects.create(name="T2 · Engineer")
    grade = Grade.objects.create(name="TG2")
    seat = Position.objects.create(name="Seat", level=level, grade=grade)
    employee = EmployeeFactory()

    updated = hr.patch(
        f"/api/v1/employees/{employee.pk}/",
        {"position_id": seat.pk, "level_id": level.pk, "grade_id": grade.pk},
        format="json",
    )

    assert updated.status_code == 200
    row = updated.json()["data"]
    assert (row["position_id"], row["level_id"], row["grade_id"]) == (
        str(seat.pk),
        str(level.pk),
        str(grade.pk),
    )

    directory = hr.get("/api/v1/org-directory/").json()["data"]
    mine = next(e for e in directory if e["id"] == str(employee.pk))
    assert mine["position_id"] == str(seat.pk)


def test_employee_without_org_links_reads_null_not_missing():
    employee = EmployeeFactory()
    row = _client("HR Admin").get(f"/api/v1/employees/{employee.pk}/").json()["data"]

    assert row["position_id"] is None and row["level_id"] is None and row["grade_id"] is None


def test_org_directory_hides_former_staff_unless_requested():
    """The org directory shows active staff by default; ?includeFormer=true
    adds exited ("Relieved") people, tagged status=exited, for HR's view."""
    from employees.models import EmployeeStatus

    client = _client("HR Admin")
    active = EmployeeFactory(status=EmployeeStatus.ACTIVE)
    exited = EmployeeFactory(status=EmployeeStatus.EXITED)

    default = client.get("/api/v1/org-directory/")
    ids = {r["id"] for r in default.json()["data"]}
    assert str(active.pk) in ids and str(exited.pk) not in ids

    withformer = client.get("/api/v1/org-directory/?includeFormer=true")
    ids2 = {r["id"] for r in withformer.json()["data"]}
    assert str(active.pk) in ids2 and str(exited.pk) in ids2
    exited_row = next(r for r in withformer.json()["data"] if r["id"] == str(exited.pk))
    assert exited_row["status"] == "exited"


def test_work_mode_is_writable_and_a_headcount_dimension():
    """Work Mode (office/remote/hybrid) can be set via the admin write API and
    breaks down headcount, alongside employment_type (contractors)."""
    hr = _client("HR Admin")

    # Create with a work mode + contract type.
    created = hr.post(
        "/api/v1/employees/",
        {"first_name": "Rem", "last_name": "Ote", "work_email": "rem@x.io",
         "employee_code": "WM-1", "work_mode": "remote", "employment_type": "contract"},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["data"]["work_mode"] == "remote"

    # Edit it back to office.
    emp_id = created.json()["data"]["id"]
    edited = hr.patch(f"/api/v1/employees/{emp_id}/", {"work_mode": "office"}, format="json")
    assert edited.status_code == 200 and edited.json()["data"]["work_mode"] == "office"

    # work_mode is an accepted analytics dimension.
    res = hr.get("/api/v1/org/analytics/headcount/?by=work_mode")
    assert res.status_code == 200, res.content
    names = {b["name"] for b in res.json()["data"]["buckets"]}
    assert names  # at least one bucket (Office/Remote/Hybrid)
