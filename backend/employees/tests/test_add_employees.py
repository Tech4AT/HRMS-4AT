"""Org Structure > Department > Employees > Add employees: HR assigns existing
employees to a department (POST org/departments/<id>/add-employees). Teams have
no employee-membership relation, so the action is 405 there."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from employees.models import Department, JobTitle, Team

pytestmark = pytest.mark.django_db


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def test_hr_adds_employees_to_department():
    hr = _hr()
    dept = Department.objects.create(name="Platform", code="DEP-PLAT")
    e1, e2 = EmployeeFactory(), EmployeeFactory()
    assert e1.department_id is None

    res = hr.post(f"/api/v1/org/departments/{dept.pk}/add-employees/", {"employeeIds": [e1.pk, e2.pk]}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["data"]["assigned"] == 2
    e1.refresh_from_db(); e2.refresh_from_db()
    assert e1.department_id == dept.pk and e2.department_id == dept.pk

    # Empty list is a 400.
    assert hr.post(f"/api/v1/org/departments/{dept.pk}/add-employees/", {"employeeIds": []}, format="json").status_code == 400


def test_hr_adds_employees_to_team_m2m():
    # Team membership is M2M: an employee can be on several teams, and adding
    # is additive (existing memberships are kept).
    hr = _hr()
    dept = Department.objects.create(name="D", code="D1")
    t1, t2 = Team.objects.create(name="Squad", department=dept), Team.objects.create(name="Guild", department=dept)
    emp = EmployeeFactory()

    assert hr.post(f"/api/v1/org/teams/{t1.pk}/add-employees/", {"employeeIds": [emp.pk]}, format="json").status_code == 200
    assert hr.post(f"/api/v1/org/teams/{t2.pk}/add-employees/", {"employeeIds": [emp.pk]}, format="json").status_code == 200
    assert set(emp.teams.values_list("pk", flat=True)) == {t1.pk, t2.pk}


def test_hr_adds_employees_to_job_title():
    # Job title (designation) is a single-valued FK, reassigned like department.
    hr = _hr()
    jt = JobTitle.objects.create(name="Staff Engineer", code="JT-STAFF")
    e1, e2 = EmployeeFactory(), EmployeeFactory()

    res = hr.post(f"/api/v1/org/job-titles/{jt.pk}/add-employees/", {"employeeIds": [e1.pk, e2.pk]}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["data"]["assigned"] == 2
    e1.refresh_from_db(); e2.refresh_from_db()
    assert e1.designation_id == jt.pk and e2.designation_id == jt.pk


def test_non_hr_cannot_add_employees():
    dept = Department.objects.create(name="D2", code="D2")
    plain = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=plain)
    c = APIClient(); c.force_authenticate(user=plain)
    res = c.post(f"/api/v1/org/departments/{dept.pk}/add-employees/", {"employeeIds": [EmployeeFactory().pk]}, format="json")
    assert res.status_code in (403, 404)
