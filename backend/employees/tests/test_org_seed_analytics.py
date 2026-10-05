"""Seed idempotency (#6) + realtime analytics endpoints (#1).

Covers the contract the frontend stream builds on: exact analytics paths,
``{success, data}`` snake_case shapes, withheld markers for grade/level,
and the org.read gate.
"""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import (
    BusinessUnit,
    CostCenter,
    Department,
    Employee,
    JobTitle,
    LegalEntity,
    Position,
    Team,
)
from employees.org_seed import seed_derived_org_masters

pytestmark = pytest.mark.django_db

SUMMARY_URL = "/api/v1/org/analytics/summary/"
HEADCOUNT_URL = "/api/v1/org/analytics/headcount/"


def _client(role_name=None):
    user = (
        UserFactory(role=Role.objects.get(name=role_name))
        if role_name
        else UserFactory(role=None)
    )
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _directory():
    """A small realistic directory: two top-level depts (one with a child),
    titles, and manager links. (The starter migration already seeds a
    default legal entity; the seed attaches to the first one.)"""
    eng = DepartmentFactory(name="Engineering")
    qa = DepartmentFactory(name="Quality", parent=eng)
    fin = DepartmentFactory(name="Finance")
    be = JobTitle.objects.create(name="Backend Engineer")
    qae = JobTitle.objects.create(name="QA Engineer")
    acc = JobTitle.objects.create(name="Accountant")
    mgr = EmployeeFactory(department=eng, designation=be, employee_code="E-001")
    dev = EmployeeFactory(department=eng, designation=be, employee_code="E-002")
    tester = EmployeeFactory(department=qa, designation=qae, employee_code="E-003")
    accountant = EmployeeFactory(department=fin, designation=acc, employee_code="E-004")
    for e in (dev, tester):
        e.manager = mgr
        e.save()
    return {"eng": eng, "qa": qa, "fin": fin, "mgr": mgr}


# --- seed ---------------------------------------------------------------


def test_seed_derives_masters_from_real_rows():
    env = _directory()

    created = seed_derived_org_masters()

    assert created == {"business_unit": 2, "cost_center": 3, "team": 3, "position": 3}
    # BusinessUnits: one per top-level dept, linked to the legal entity.
    assert set(BusinessUnit.objects.values_list("name", flat=True)) == {
        "Engineering",
        "Finance",
    }
    bu = BusinessUnit.objects.get(name="Engineering")
    assert bu.legal_entity == LegalEntity.objects.order_by("id").first()
    assert bu.head == env["mgr"]
    # Departments roll up; employees inherit.
    assert Department.objects.get(name="Quality").business_unit == bu
    for code in ("E-001", "E-002", "E-003"):
        assert Employee.objects.get(employee_code=code).business_unit == bu
    assert Employee.objects.get(employee_code="E-004").business_unit.name == "Finance"
    # CostCenters: one per populated dept, owned by the busiest manager.
    cc = CostCenter.objects.get(name="Engineering Cost Center")
    assert cc.owner == env["mgr"] and cc.legal_entity == bu.legal_entity
    assert Employee.objects.get(employee_code="E-001").cost_center == cc
    # Teams: led by a real manager.
    team = Team.objects.get(name="Engineering Team")
    assert team.lead == env["mgr"] and team.department.name == "Engineering"
    # Positions: one per (title, dept) combo, incumbent = lowest code.
    seat = Position.objects.get(name="Backend Engineer — Engineering")
    assert seat.status == "filled" and seat.incumbent.employee_code == "E-001"
    assert seat.job_title.name == "Backend Engineer"
    assert seat.business_unit == bu
    holders = set(
        Employee.objects.filter(position=seat).values_list("employee_code", flat=True)
    )
    assert holders == {"E-001", "E-002"}


def test_seed_is_idempotent_and_never_overwrites_human_edits():
    _directory()
    first = seed_derived_org_masters()
    assert first == {"business_unit": 2, "cost_center": 3, "team": 3, "position": 3}

    # A human renames a team lead and unassigns someone: re-runs must keep it.
    team = Team.objects.get(name="Engineering Team")
    other = Employee.objects.get(employee_code="E-002")
    team.lead = other
    team.save()
    lone = Employee.objects.get(employee_code="E-004")
    lone.business_unit = None
    lone.position = None
    lone.save()

    second = seed_derived_org_masters()

    assert second == {"business_unit": 0, "cost_center": 0, "team": 0, "position": 0}
    assert BusinessUnit.objects.count() == 2
    assert CostCenter.objects.count() == 3
    assert Team.objects.count() == 3
    assert Position.objects.count() == 3
    team.refresh_from_db()
    assert team.lead == other  # human edit kept
    lone.refresh_from_db()
    # Empty links refill (nothing human-set is clobbered — these were empty).
    assert lone.business_unit.name == "Finance"
    assert lone.position.name == "Accountant — Finance"


def test_seed_with_no_employees_creates_nothing():
    assert seed_derived_org_masters() == {
        "business_unit": 0,
        "cost_center": 0,
        "team": 0,
        "position": 0,
    }


# --- analytics ----------------------------------------------------------


def test_summary_returns_live_breakdowns_with_withheld_grade_level():
    _directory()
    seed_derived_org_masters()
    exited = Employee.objects.get(employee_code="E-004")
    exited.status = Employee.STATUS_EXITED
    exited.save()

    body = _client("HR Admin").get(SUMMARY_URL).json()

    assert body["success"] is True
    data = body["data"]
    assert data["total_headcount"] == 4  # exited excluded (3 directory + analyst)
    assert data["total_records"] == 5  # 4 directory + the client employee
    by_dept = {b["name"]: b["headcount"] for b in data["by_department"]}
    assert by_dept["Engineering"] == 2 and by_dept["Quality"] == 1
    by_bu = {b["name"]: b["headcount"] for b in data["by_business_unit"]}
    assert by_bu["Engineering"] == 3  # child rolls up
    assert data["by_grade"]["withheld"] == "no-source-data"
    assert data["by_level"]["withheld"] == "no-source-data"
    assert "gender" in data["unavailable"]  # honest gap, not a chart
    statuses = {b["name"]: b["headcount"] for b in data["by_status"]}
    assert statuses["exited"] == 1  # by_status sees exits


def test_headcount_dimensions_filters_and_bad_dimension():
    _directory()
    seed_derived_org_masters()
    client = _client("Manager")

    by_type = client.get(HEADCOUNT_URL, {"by": "employment_type"}).json()["data"]
    assert by_type["buckets"] and by_type["total"] == 5

    eng_id = Department.objects.get(name="Engineering").pk
    filtered = client.get(HEADCOUNT_URL, {"by": "status", "department": eng_id}).json()["data"]
    assert filtered["total"] == 2

    bad = client.get(HEADCOUNT_URL, {"by": "salary"})
    assert bad.status_code == 400
    assert bad.json()["success"] is False


def test_analytics_gate():
    _directory()
    assert _client("Employee").get(SUMMARY_URL).status_code == 200
    assert _client("Finance").get(HEADCOUNT_URL).status_code == 200
    assert _client(None).get(SUMMARY_URL).status_code == 403  # no roles, no org.read
    from rest_framework.test import APIClient as RawClient

    assert RawClient().get(SUMMARY_URL).status_code == 401
