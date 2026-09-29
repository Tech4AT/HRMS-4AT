"""Employee Reports endpoints: catalog, run/export, saved custom reports.

Covers the contract the Employee Reports tab builds on: exact report paths,
``{success, data}`` snake_case shapes, the 14 All-Employees columns, filter
semantics (department includes sub-departments, band resolves grade names),
personal-field gating, honest-empty markers, CSV export, CustomReport CRUD
(owner-scoped) and the org.read gate.
"""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import CustomReport, Employee, Grade, JobTitle
from employees.reports import ALL_EMPLOYEES_COLUMNS

pytestmark = pytest.mark.django_db

CATALOG_URL = "/api/v1/org/reports/catalog/"
RUN_URL = "/api/v1/org/reports/run/"
EXPORT_URL = "/api/v1/org/reports/export/"
CUSTOM_URL = "/api/v1/org/reports/custom/"


def _client(role_name=None):
    user = (
        UserFactory(role=Role.objects.get(name=role_name))
        if role_name
        else UserFactory(role=None)
    )
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _directory():
    eng = DepartmentFactory(name="Engineering")
    qa = DepartmentFactory(name="Quality", parent=eng)
    be = JobTitle.objects.create(name="Backend Engineer")
    mgr = EmployeeFactory(
        department=eng,
        designation=be,
        employee_code="E-001",
        personal_email="mgr@example.com",
        phone="+911234567890",
    )
    dev = EmployeeFactory(
        department=eng, designation=be, employee_code="E-002", manager=mgr
    )
    tester = EmployeeFactory(
        department=qa, designation=be, employee_code="E-003", manager=mgr
    )
    return {"eng": eng, "qa": qa, "mgr": mgr, "dev": dev, "tester": tester}


# --- catalog ------------------------------------------------------------


def test_catalog_lists_categories_cards_and_field_groups():
    client, _ = _client("HR Admin")

    res = client.get(CATALOG_URL)

    assert res.status_code == 200
    data = res.json()["data"]
    labels = [c["label"] for c in data["categories"]]
    assert "Employee Info" in labels
    assert "Scheduled reports" in labels
    info = next(c for c in data["categories"] if c["id"] == "employee_info")
    titles = [r["title"] for r in info["reports"]]
    for expected in (
        "All Employees",
        "Employee Master Details",
        "Employee Job Details",
        "Employee Roles",
        "Employee Without Reporting Manager",
        "Reporting Managers Report",
        "Employee Work Experience Report",
        "Employee Documents Report",
        "Employee Profile Picture Status Report",
    ):
        assert expected in titles
    groups = [g["name"] for g in data["field_groups"]]
    assert groups == [
        "Employee Basic Info",
        "Personal Info",
        "Job Info",
        "Contact Info",
        "Identity Info",
    ]
    assert all(g["count"] > 0 for g in data["field_groups"])


def test_reports_require_org_read():
    client, _ = _client()  # no role at all

    assert client.get(CATALOG_URL).status_code == 403
    assert client.get(RUN_URL, {"type": "all_employees"}).status_code == 403
    assert client.get(EXPORT_URL, {"type": "all_employees"}).status_code == 403
    assert client.get(CUSTOM_URL).status_code == 403


def test_unknown_report_type_is_400():
    client, _ = _client("HR Admin")

    res = client.get(RUN_URL, {"type": "nope"})

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "UNKNOWN_REPORT"


# --- All Employees ------------------------------------------------------


def test_all_employees_columns_rows_and_manager_names():
    client, _ = _client("HR Admin")
    env = _directory()

    res = client.get(RUN_URL, {"type": "all_employees"})

    assert res.status_code == 200
    data = res.json()["data"]
    assert [c["key"] for c in data["columns"]] == ALL_EMPLOYEES_COLUMNS
    assert len(ALL_EMPLOYEES_COLUMNS) == 14
    rows = {r["employee_number"]: r for r in data["rows"]}
    assert set(("E-001", "E-002", "E-003")) <= set(rows)
    dev = rows["E-002"]
    assert dev["full_name"]
    assert dev["department"] == "Engineering"
    assert rows["E-003"]["department"] == "Engineering"
    assert rows["E-003"]["sub_department"] == "Quality"
    assert dev["reporting_to"] == rows["E-001"]["full_name"]
    assert rows["E-001"]["reporting_to"] == ""
    # No dotted-line FK on this branch — honest blank, never fabricated.
    assert all(r["dotted_line_manager"] == "" for r in data["rows"])
    # No grade assigned — band blank, never fabricated.
    assert dev["band"] == ""
    assert data["unavailable"] is None
    assert env["mgr"].employee_code == "E-001"


def test_band_reads_grade_name_when_assigned():
    client, _ = _client("HR Admin")
    env = _directory()
    grade, _ = Grade.objects.get_or_create(name="G3")
    env["dev"].grade = grade
    env["dev"].save()

    res = client.get(RUN_URL, {"type": "all_employees"})

    rows = {r["employee_number"]: r for r in res.json()["data"]["rows"]}
    assert rows["E-002"]["band"] == "G3"


def test_filters_department_search_and_band():
    client, _ = _client("HR Admin")
    env = _directory()
    grade, _ = Grade.objects.get_or_create(name="G3")
    env["dev"].grade = grade
    env["dev"].save()

    # Top-level department catches its sub-department's people too.
    res = client.get(RUN_URL, {"type": "all_employees", "department": str(env["eng"].id)})
    assert {r["employee_number"] for r in res.json()["data"]["rows"]} >= {
        "E-002",
        "E-003",
    }

    res = client.get(RUN_URL, {"type": "all_employees", "department": str(env["qa"].id)})
    assert {r["employee_number"] for r in res.json()["data"]["rows"]} >= {"E-003"}
    assert "E-002" not in {r["employee_number"] for r in res.json()["data"]["rows"]}

    res = client.get(RUN_URL, {"type": "all_employees", "search": "E-002"})
    assert [r["employee_number"] for r in res.json()["data"]["rows"]] == ["E-002"]

    res = client.get(RUN_URL, {"type": "all_employees", "band": "g3"})
    assert [r["employee_number"] for r in res.json()["data"]["rows"]] == ["E-002"]


def test_without_manager_lists_only_managerless():
    client, _ = _client("HR Admin")
    _directory()

    res = client.get(RUN_URL, {"type": "without_manager"})

    codes = [r["employee_number"] for r in res.json()["data"]["rows"]]
    assert "E-001" in codes
    assert "E-002" not in codes
    assert "E-003" not in codes


def test_reporting_managers_counts():
    client, _ = _client("HR Admin")
    _directory()

    res = client.get(RUN_URL, {"type": "reporting_managers"})

    rows = {r["employee_number"]: r for r in res.json()["data"]["rows"]}
    assert rows["E-001"]["direct_reports"] == 2
    assert rows["E-001"]["team_size"] == 2
    assert "E-002" not in rows


def test_master_details_gates_personal_fields():
    _directory()
    hr, _ = _client("HR Admin")
    mgr_client, _ = _client("Manager")

    hr_rows = {
        r["employee_number"]: r
        for r in hr.get(RUN_URL, {"type": "master_details"}).json()["data"]["rows"]
    }
    assert hr_rows["E-001"]["personal_email"] == "mgr@example.com"
    assert hr_rows["E-001"]["phone"] == "+911234567890"

    mgr_rows = {
        r["employee_number"]: r
        for r in mgr_client.get(RUN_URL, {"type": "master_details"}).json()["data"]["rows"]
    }
    assert mgr_rows["E-001"]["personal_email"] == ""
    assert mgr_rows["E-001"]["phone"] == ""


def test_honest_empty_reports_carry_unavailable():
    client, _ = _client("HR Admin")
    _directory()

    for report_type in ("work_experience", "profile_picture", "custom_fields"):
        res = client.get(RUN_URL, {"type": report_type})
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["rows"] == []
        assert data["unavailable"]


def test_exits_lists_exited_and_open_resignations():
    from employees.models import Resignation

    client, _ = _client("HR Admin")
    env = _directory()
    env["tester"].status = Employee.STATUS_EXITED
    env["tester"].exit_reason = "Better opportunity"
    env["tester"].save()
    Resignation.objects.create(
        employee=env["dev"],
        reason="Relocation",
        requested_last_day="2026-12-31",
        submitted_by=env["dev"].user,
    )

    res = client.get(RUN_URL, {"type": "exits"})

    rows = {r["employee_number"]: r for r in res.json()["data"]["rows"]}
    assert rows["E-003"]["reason"] == "Better opportunity"
    assert rows["E-002"]["resignation_status"] == "submitted"
    assert "E-001" not in rows


# --- export -------------------------------------------------------------


def test_export_returns_csv_with_label_header():
    client, _ = _client("HR Admin")
    _directory()

    res = client.get(EXPORT_URL, {"type": "all_employees"})

    assert res.status_code == 200
    assert res["Content-Type"] == "text/csv"
    first_line = res.content.decode().splitlines()[0]
    assert "Employee Number" in first_line
    assert "Full Name" in first_line
    assert "E-001" in res.content.decode()


# --- custom reports -----------------------------------------------------


def test_custom_report_crud_is_owner_scoped():
    hr, hr_user = _client("HR Admin")
    other, _ = _client("HR Admin")
    _directory()

    created = hr.post(
        CUSTOM_URL,
        {
            "name": "Eng ward",
            "base_type": "all_employees",
            "selected_fields": ["employee_number", "full_name", "department"],
            "filters": {"search": "E-00"},
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    saved_id = created.json()["id"]

    assert [r["name"] for r in hr.get(CUSTOM_URL).json()["results"]] == ["Eng ward"]
    assert other.get(CUSTOM_URL).json()["results"] == []

    run = hr.get(RUN_URL, {"custom": saved_id})
    assert run.status_code == 200
    data = run.json()["data"]
    assert [c["key"] for c in data["columns"]] == [
        "employee_number",
        "full_name",
        "department",
    ]
    assert data["custom"]["name"] == "Eng ward"

    assert other.get(RUN_URL, {"custom": saved_id}).status_code == 404

    duplicate = hr.post(
        CUSTOM_URL,
        {
            "name": "Eng ward",
            "base_type": "all_employees",
            "selected_fields": ["employee_number"],
            "filters": {},
        },
        format="json",
    )
    assert duplicate.status_code == 400

    assert hr.delete(f"{CUSTOM_URL}{saved_id}/").status_code == 204
    assert CustomReport.objects.filter(owner=hr_user).count() == 0


def test_custom_report_validation():
    client, _ = _client("HR Admin")

    bad_base = client.post(
        CUSTOM_URL,
        {
            "name": "x",
            "base_type": "login_activity",
            "selected_fields": ["employee_number"],
            "filters": {},
        },
        format="json",
    )
    assert bad_base.status_code == 400

    bad_field = client.post(
        CUSTOM_URL,
        {
            "name": "x",
            "base_type": "all_employees",
            "selected_fields": ["nope"],
            "filters": {},
        },
        format="json",
    )
    assert bad_field.status_code == 400

    bad_filter = client.post(
        CUSTOM_URL,
        {
            "name": "x",
            "base_type": "all_employees",
            "selected_fields": ["employee_number"],
            "filters": {"nope": "1"},
        },
        format="json",
    )
    assert bad_filter.status_code == 400
