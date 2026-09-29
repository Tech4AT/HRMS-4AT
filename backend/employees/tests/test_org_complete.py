"""Org complete build: enriched masters, JobTitle rename, OrgSetting /
CodeScheme / HierarchyRule + their admin endpoints (permission org.manage).

Covers the contract the FE stream builds on: exact admin paths, camelCase
field names, the hierarchy-rules/validate action, and the
code-schemes/<id>/next-code action.
"""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from employees.models import (
    BusinessUnit,
    CodeScheme,
    CostCenter,
    Department,
    Employee,
    HierarchyRule,
    JobTitle,
    LegalEntity,
    Level,
    OrgSetting,
    validate_manager,
)

pytestmark = pytest.mark.django_db


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def test_enriched_department_crud_with_new_relations():
    hr, _ = _hr()
    cc = CostCenter.objects.create(name="CC ENG", code="CC-ENG")
    bu = BusinessUnit.objects.create(name="Cloud", code="BU-CLD")
    head = EmployeeFactory()

    created = hr.post(
        "/api/v1/org/departments/",
        {
            "name": "Platform",
            "code": "DEPT-PLAT",
            "description": "Platform engineering",
            "head": head.pk,
            "cost_center": cc.pk,
            "business_unit": bu.pk,
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["code"] == "DEPT-PLAT"
    assert body["description"] == "Platform engineering"
    assert body["costCenter"] == cc.pk and body["costCenterName"] == "CC ENG"
    assert body["businessUnit"] == bu.pk and body["businessUnitName"] == "Cloud"
    assert body["head"] == head.pk and body["headName"]

    dept = Department.objects.get(pk=body["id"])
    assert dept.head_id == head.pk
    assert dept.cost_center_id == cc.pk
    assert dept.business_unit_id == bu.pk


def test_location_and_legal_entity_enriched_fields():
    hr, _ = _hr()
    loc = hr.post(
        "/api/v1/org/locations/",
        {
            "name": "Hyderabad HQ",
            "code": "LOC-HYD",
            "address_line1": "4AT Consulting LLP",
            "city": "Hyderabad",
            "state": "Telangana",
            "country": "India",
            "postal_code": "500001",
            "timezone": "Asia/Kolkata",
            "type": "hq",
        },
        format="json",
    )
    assert loc.status_code == 201, loc.content
    assert loc.json()["city"] == "Hyderabad"
    assert loc.json()["type"] == "hq"

    le = hr.post(
        "/api/v1/org/legal-entities/",
        {
            "name": "4AT Consulting LLP",
            "code": "LE-4AT",
            "country": "India",
            "currency": "INR",
            "registered_address": loc.json()["id"],
            "logo": "https://example.com/logo.png",
        },
        format="json",
    )
    assert le.status_code == 201, le.content
    assert le.json()["currency"] == "INR"
    assert le.json()["registeredAddress"] == loc.json()["id"]
    entity = LegalEntity.objects.get(pk=le.json()["id"])
    assert entity.registered_address.code == "LOC-HYD"


def test_business_unit_parent_nesting_and_delete_blocked():
    hr, _ = _hr()
    parent = hr.post("/api/v1/org/business-units/", {"name": "Technology"}, format="json")
    assert parent.status_code == 201
    child = hr.post(
        "/api/v1/org/business-units/",
        {"name": "Cloud Division", "parent": parent.json()["id"]},
        format="json",
    )
    assert child.status_code == 201, child.content
    assert child.json()["parent"] == parent.json()["id"]
    assert child.json()["parentName"] == "Technology"

    blocked = hr.delete(f"/api/v1/org/business-units/{parent.json()['id']}/")
    assert blocked.status_code == 409
    assert hr.delete(f"/api/v1/org/business-units/{child.json()['id']}/").status_code == 204
    assert hr.delete(f"/api/v1/org/business-units/{parent.json()['id']}/").status_code == 204


def test_job_title_crud_with_family_level_and_manager_flag():
    hr, _ = _hr()
    fam = hr.post("/api/v1/org/job-families/", {"name": "VFY Engineering"}, format="json")
    assert fam.status_code == 201
    lvl = hr.post(
        "/api/v1/org/levels/", {"name": "VFY L3 Senior", "rank": 3, "job_family": fam.json()["id"]},
        format="json",
    )
    assert lvl.status_code == 201, lvl.content
    assert lvl.json()["rank"] == 3
    assert lvl.json()["jobFamily"] == fam.json()["id"]

    title = hr.post(
        "/api/v1/org/job-titles/",
        {
            "name": "VFY Senior Backend Engineer",
            "code": "JT-SBE",
            "job_family": fam.json()["id"],
            "level": lvl.json()["id"],
            "is_people_manager": True,
        },
        format="json",
    )
    assert title.status_code == 201, title.content
    body = title.json()
    assert body["jobFamilyName"] == "VFY Engineering"
    assert body["levelName"] == "VFY L3 Senior"
    assert body["isPeopleManager"] is True

    # Historic alias path serves the same rows.
    legacy = hr.get("/api/v1/org/designations/")
    assert legacy.status_code == 200
    assert any(r["name"] == "VFY Senior Backend Engineer" for r in legacy.json()["results"])
    legacy_read = hr.get("/api/v1/designations/")
    assert legacy_read.status_code == 200

    row = JobTitle.objects.get(name="VFY Senior Backend Engineer")
    assert row.code == "JT-SBE" and row.is_people_manager is True


def test_job_title_rename_preserves_position_and_employee_links():
    title = JobTitle.objects.create(name="Rename Probe", code="JT-RP")
    dept = Department.objects.create(name="Rename Dept")
    emp = EmployeeFactory()
    emp.designation = title
    emp.save()
    from employees.models import Position

    seat = Position.objects.create(name="Probe Seat", job_title=title, department=dept)
    assert Employee.objects.get(pk=emp.pk).designation.name == "Rename Probe"
    assert Position.objects.get(pk=seat.pk).job_title.name == "Rename Probe"
    assert title.employees.count() == 1 and title.positions.count() == 1


def test_codescheme_render_increment_and_next_code_action():
    scheme = CodeScheme.objects.create(
        entity_type="vf-probe", prefix="VF", padding=3, separator="-", next_seq=7
    )
    assert scheme.render() == "VF-007"
    first = CodeScheme.next_code("vf-probe")
    second = CodeScheme.next_code("vf-probe")
    assert (first, second) == ("VF-007", "VF-008")
    scheme.refresh_from_db()
    assert scheme.next_seq == 9

    hr, _ = _hr()
    resp = hr.post(f"/api/v1/org/code-schemes/{scheme.pk}/next-code/", {}, format="json")
    assert resp.status_code == 200
    assert resp.json()["data"]["code"] == "VF-009"

    scheme.is_active = False
    scheme.save()
    assert hr.post(f"/api/v1/org/code-schemes/{scheme.pk}/next-code/", {}).status_code == 409


def test_orgsetting_get_set_helper_and_endpoint():
    assert OrgSetting.get_setting("directory.show_exits", default=True) is True
    OrgSetting.set_setting("directory.show_exits", False, category="directory")
    assert OrgSetting.get_setting("directory.show_exits") is False

    hr, _ = _hr()
    created = hr.post(
        "/api/v1/org/org-settings/",
        {"key": "onboarding.buddy_required", "value": True, "category": "onboarding"},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert OrgSetting.get_setting("onboarding.buddy_required") is True
    listed = hr.get("/api/v1/org/org-settings/?search=onboarding")
    assert listed.status_code == 200
    assert any(r["key"] == "onboarding.buddy_required" for r in listed.json()["results"])


def test_hierarchy_rule_validate_action_and_write_enforcement():
    hr, hr_employee = _hr()
    l2 = Level.objects.create(name="HR L2", rank=2)
    l3 = Level.objects.create(name="HR L3", rank=3)
    dept = Department.objects.create(name="HR Dept")
    other = Department.objects.create(name="Other Dept")
    manager = EmployeeFactory()
    manager.level = l3
    manager.department = dept
    manager.save()
    report = EmployeeFactory()
    report.level = l2
    report.department = dept
    report.save()

    rule = hr.post(
        "/api/v1/org/hierarchy-rules/",
        {
            "from_level": l2.pk,
            "must_report_to_level": l3.pk,
            "same_department": True,
        },
        format="json",
    )
    assert rule.status_code == 201, rule.content
    assert rule.json()["mustReportToLevelName"] == "HR L3"

    ok = hr.post(
        "/api/v1/org/hierarchy-rules/validate/",
        {"employee_id": report.pk, "manager_id": manager.pk},
        format="json",
    )
    assert ok.json()["data"] == {"valid": True, "errors": []}

    outsider = EmployeeFactory()
    outsider.level = l2
    outsider.department = other
    outsider.save()
    bad = hr.post(
        "/api/v1/org/hierarchy-rules/validate/",
        {"employee_id": outsider.pk, "manager_id": manager.pk},
        format="json",
    )
    assert bad.json()["data"]["valid"] is False
    assert any("same department" in e for e in bad.json()["data"]["errors"])

    # Model-level checker agrees.
    assert validate_manager(report, manager) == []
    assert validate_manager(outsider, manager) != []

    # Write path enforces the rule: assigning the cross-dept manager fails.
    patched = hr.patch(
        f"/api/v1/employees/{outsider.pk}/",
        {"manager_id": manager.pk},
        format="json",
    )
    assert patched.status_code == 400, patched.content

    # Deactivating the rule re-opens the write.
    assert hr.patch(
        f"/api/v1/org/hierarchy-rules/{rule.json()['id']}/", {"active": False}, format="json"
    ).status_code == 200
    retry = hr.patch(
        f"/api/v1/employees/{outsider.pk}/",
        {"manager_id": manager.pk},
        format="json",
    )
    assert retry.status_code == 200, retry.content
    HierarchyRule.objects.all().delete()


def test_employee_and_position_resolve_new_relations_in_directory():
    bu = BusinessUnit.objects.create(name="Dir BU")
    dept = Department.objects.create(name="Dir Dept", business_unit=bu)
    emp = EmployeeFactory()
    emp.department = dept
    emp.save()
    hr, _ = _hr()
    resp = hr.get(f"/api/v1/employees/{emp.pk}/")
    assert resp.status_code == 200
    assert resp.json()["data"]["department_id"] == str(dept.pk)
