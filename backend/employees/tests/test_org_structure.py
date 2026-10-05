"""Managing the organisation structure: departments, job titles, locations,
legal entities, business units and cost centres (permission org.manage)."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import (
    BusinessUnit,
    CostCenter,
    Department,
    JobTitle,
    LegalEntity,
    Location,
)

pytestmark = pytest.mark.django_db

KINDS = {
    "departments": Department,
    "designations": JobTitle,
    "job-titles": JobTitle,
    "locations": Location,
    "legal-entities": LegalEntity,
    "business-units": BusinessUnit,
    "cost-centers": CostCenter,
}


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(kind, pk=None):
    return f"/api/v1/org/{kind}/" + (f"{pk}/" if pk else "")


@pytest.mark.parametrize("kind,model", KINDS.items())
def test_hr_creates_renames_and_deletes_every_kind_of_unit(kind, model):
    hr = _client("HR Admin")

    created = hr.post(_url(kind), {"name": f"Test {kind}"}, format="json")
    assert created.status_code == 201
    pk = created.json()["id"]
    assert created.json()["employeeCount"] == 0 and created.json()["isActive"] is True

    renamed = hr.patch(_url(kind, pk), {"name": f"Renamed {kind}"}, format="json")
    assert renamed.status_code == 200 and renamed.json()["name"] == f"Renamed {kind}"

    assert hr.delete(_url(kind, pk)).status_code == 204
    assert not model.objects.filter(pk=pk).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        f"{model.__name__}.created",
        f"{model.__name__}.updated",
        f"{model.__name__}.deleted",
    } <= actions


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
@pytest.mark.parametrize("kind", KINDS)
def test_only_holders_of_org_manage_can_use_it(role, kind):
    client = _client(role)

    assert client.get(_url(kind)).status_code == 403
    assert client.post(_url(kind), {"name": "X"}, format="json").status_code == 403


def test_anonymous_is_refused():
    assert APIClient().get(_url("departments")).status_code == 401


def test_a_duplicate_name_is_rejected_with_a_field_error():
    hr = _client("HR Admin")
    DepartmentFactory(name="Finance Ops")

    response = hr.post(_url("departments"), {"name": "Finance Ops"}, format="json")

    assert response.status_code == 400
    assert "name" in response.json()["error"]["fields"]


def test_cost_centres_carry_a_finance_code_and_can_be_found_by_it():
    hr = _client("HR Admin")
    hr.post(_url("cost-centers"), {"name": "Platform", "code": "CC-4471"}, format="json")

    found = hr.get(_url("cost-centers"), {"search": "4471"}).json()["results"]

    assert [c["name"] for c in found] == ["Platform"] and found[0]["code"] == "CC-4471"


def test_lists_show_how_many_people_are_in_each_unit_and_can_be_searched():
    hr = _client("HR Admin")
    dept = DepartmentFactory(name="Search Target")
    DepartmentFactory(name="Other")
    EmployeeFactory(department=dept)
    EmployeeFactory(department=dept)

    rows = hr.get(_url("departments"), {"search": "target"}).json()["results"]

    assert [(r["name"], r["employeeCount"]) for r in rows] == [("Search Target", 2)]


# --- departments have a hierarchy that must stay a tree -------------------------------


def test_a_department_can_sit_under_another_and_reports_its_parent():
    hr = _client("HR Admin")
    parent = DepartmentFactory()

    child = hr.post(_url("departments"), {"name": "Sub Team", "parent": parent.pk}, format="json")

    assert child.status_code == 201
    assert child.json()["parentName"] == parent.name
    assert hr.get(_url("departments", parent.pk)).json()["childCount"] == 1


def test_a_department_cannot_be_its_own_parent():
    hr = _client("HR Admin")
    dept = DepartmentFactory()

    response = hr.patch(_url("departments", dept.pk), {"parent": dept.pk}, format="json")

    assert response.status_code == 400 and "parent" in response.json()["error"]["fields"]


def test_a_department_cannot_be_moved_under_its_own_descendant():
    hr = _client("HR Admin")
    top = DepartmentFactory()
    middle = DepartmentFactory(parent=top)
    bottom = DepartmentFactory(parent=middle)

    response = hr.patch(_url("departments", top.pk), {"parent": bottom.pk}, format="json")

    assert response.status_code == 400
    top.refresh_from_db()
    assert top.parent_id is None


# --- what may be deleted -----------------------------------------------------------------


@pytest.mark.parametrize("kind,field", [("departments", "department"), ("locations", "location")])
def test_a_unit_people_still_belong_to_cannot_be_deleted(kind, field):
    hr = _client("HR Admin")
    unit = KINDS[kind].objects.create(name="In use")
    EmployeeFactory(**{field: unit})
    EmployeeFactory(**{field: unit})

    response = hr.delete(_url(kind, unit.pk))

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "CONFLICT" and "2 people" in error["message"]
    assert "deactivate" in error["message"]
    assert KINDS[kind].objects.filter(pk=unit.pk).exists()


def test_a_department_with_sub_departments_cannot_be_deleted():
    hr = _client("HR Admin")
    parent = DepartmentFactory()
    DepartmentFactory(parent=parent)

    response = hr.delete(_url("departments", parent.pk))

    assert response.status_code == 409 and "sub-department" in response.json()["error"]["message"]


def test_a_deactivated_unit_leaves_the_pickers_but_stays_in_the_admin_list():
    hr = _client("HR Admin")
    location = Location.objects.create(name="Old Office")

    hr.patch(_url("locations", location.pk), {"isActive": False}, format="json")

    picker = hr.get("/api/v1/locations/").json()["data"]
    admin_rows = hr.get(_url("locations")).json()["results"]
    assert "Old Office" not in [r["name"] for r in picker]
    assert [r["isActive"] for r in admin_rows if r["name"] == "Old Office"] == [False]


# --- the read-only lists the frontend pages call -----------------------------------------


@pytest.mark.parametrize("path", ["business-units", "cost-centers"])
def test_business_units_and_cost_centres_are_readable_in_the_frontend_shape(path):
    (BusinessUnit if path == "business-units" else CostCenter).objects.create(name="Visible")
    (BusinessUnit if path == "business-units" else CostCenter).objects.create(
        name="Hidden", is_active=False
    )

    response = _client("Employee").get(f"/api/v1/{path}/")

    body = response.json()
    assert response.status_code == 200 and body["success"] is True
    assert [r["name"] for r in body["data"]] == ["Visible"]
    assert isinstance(body["data"][0]["id"], str)
