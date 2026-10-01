"""Role x endpoint access matrix for the payroll API (PRD §8, UAT PAY-022).

Expectations are written out by hand per role, not derived from the code under
test: a change to a permission grant or a view's permission shows up here."""

import pytest
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from employees.models import Employee
from payroll import models as m

pytestmark = pytest.mark.django_db

ROLES = {
    "admin": "payroll.admin@demo.4at",
    "reviewer": "finance.reviewer@demo.4at",
    "approver": "payroll.approver@demo.4at",
    "auditor": "auditor@demo.4at",
    "hr": "hr.admin@demo.4at",
    "employee": "nikhil.kommineni@demo.4at",
}
ALL = set(ROLES)
STAFF = ALL - {"employee"}

# GET endpoint -> roles that may read it
READ_MATRIX = {
    "components/": STAFF,
    "salary-structures/": STAFF,
    "statutory-rules/": STAFF,
    "pay-groups/": ALL,
    "employees/": ALL,
    "compensations/": ALL,
    "periods/": STAFF,
    "runs/": STAFF,
    "dashboard/": STAFF,
    "reports/": STAFF,
    "audit/": {"admin", "auditor", "hr"},
    "loans/": STAFF,
    "payslips/": STAFF,
    "meta/": ALL,
    "my/summary/": ALL,
    "my/payslips/": ALL,
}


@pytest.fixture
def clients():
    with override_settings(DEBUG=True):
        call_command("seed_payroll", "--demo", verbosity=0)
    out = {}
    for role, email in ROLES.items():
        client = APIClient()
        client.force_authenticate(User.objects.get(email=email))
        out[role] = client
    return out


@pytest.mark.parametrize("path", sorted(READ_MATRIX))
def test_read_access_matrix(clients, path):
    for role, client in clients.items():
        status = client.get(f"/api/v1/payroll/{path}").status_code
        expected = 200 if role in READ_MATRIX[path] else 403
        assert status == expected, f"{role} GET {path}: {status}, expected {expected}"


def test_anonymous_is_rejected(clients):
    for path in READ_MATRIX:
        assert APIClient().get(f"/api/v1/payroll/{path}").status_code == 401


def test_employee_sees_only_their_own_records(clients):
    me = Employee.objects.get(employee_code="4AT-002")
    rows = clients["employee"].get("/api/v1/payroll/employees/").json()["data"]
    assert [r["id"] for r in rows] == [me.pk]
    other = Employee.objects.get(employee_code="4AT-001")
    assert clients["employee"].get(f"/api/v1/payroll/employees/{other.pk}/").status_code == 403
    revisions = clients["employee"].get("/api/v1/payroll/compensations/").json()["data"]
    assert {r["employee"]["id"] for r in revisions} == {me.pk}


def test_write_matrix(clients):
    component = {
        "code": "RBAC_TEST",
        "name": "RBAC test",
        "component_type": "earning",
        "calculation_type": "fixed",
        "value": "1",
        "effective_from": "2026-09-01",
    }
    for role, client in clients.items():
        payload = {**component, "code": f"RBAC_{role.upper()}"}
        status = client.post("/api/v1/payroll/components/", payload, format="json").status_code
        expected = 201 if role in {"admin", "hr"} else 403
        assert status == expected, f"{role} create component: {status}"

    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    for role, client in clients.items():
        status = client.post(
            "/api/v1/payroll/periods/",
            {"pay_group": str(group.pk), "year": 2027, "month": 1},
            format="json",
        ).status_code
        if role in {"admin"}:
            assert status == 201, role
        elif role == "hr":
            assert status == 409, role  # already created by admin: duplicate, but allowed
        else:
            assert status == 403, f"{role} create period: {status}"

    period = m.PayrollPeriod.objects.get(year=2027, month=1)
    for role, client in clients.items():
        status = client.post(
            f"/api/v1/payroll/periods/{period.pk}/calculate/", {}, format="json"
        ).status_code
        expected = 201 if role in {"admin", "hr"} else 403
        assert status == expected, f"{role} calculate: {status}"

    run = period.runs.get(is_current=True)
    # finalize needs payroll.finalize (approver/hr); reopen needs payroll.reopen (hr only)
    assert (
        clients["admin"]
        .post(f"/api/v1/payroll/runs/{run.pk}/finalize/", {}, format="json")
        .status_code
        == 403
    )
    assert (
        clients["reviewer"]
        .post(f"/api/v1/payroll/runs/{run.pk}/finalize/", {}, format="json")
        .status_code
        == 403
    )
    assert (
        clients["approver"]
        .post(f"/api/v1/payroll/runs/{run.pk}/finalize/", {}, format="json")
        .status_code
        == 409
    )
    assert (
        clients["approver"]
        .post(f"/api/v1/payroll/runs/{run.pk}/reopen/", {}, format="json")
        .status_code
        == 403
    )
    assert (
        clients["auditor"]
        .post(f"/api/v1/payroll/runs/{run.pk}/submit/", {}, format="json")
        .status_code
        == 403
    )
    assert clients["employee"].get(f"/api/v1/payroll/runs/{run.pk}/results/").status_code == 403

    # Only reviewers/approvers can decide; the preparer's own submit is not an approval
    nikhil = Employee.objects.get(employee_code="4AT-002")
    assert (
        clients["auditor"]
        .put(f"/api/v1/payroll/employees/{nikhil.pk}/profile/", {}, format="json")
        .status_code
        == 403
    )
    assert (
        clients["reviewer"]
        .put(f"/api/v1/payroll/employees/{nikhil.pk}/profile/", {}, format="json")
        .status_code
        == 403
    )


def test_every_endpoint_answers_without_server_errors(clients):
    """Route smoke test: after a calculated run, every list and detail route the
    UI uses responds without a 5xx for the Payroll Admin."""
    admin = clients["admin"]
    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    pid = admin.post(
        "/api/v1/payroll/periods/",
        {"pay_group": str(group.pk), "year": 2026, "month": 9},
        format="json",
    ).json()["data"]["id"]
    admin.post(f"/api/v1/payroll/periods/{pid}/attendance/fill-missing/", {}, format="json")
    run = admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json").json()["data"]
    result = m.EmployeePayrollResult.objects.filter(run_id=run["id"]).first()
    structure = m.SalaryStructure.objects.first()
    component = m.SalaryComponent.objects.first()
    nikhil = Employee.objects.get(employee_code="4AT-002")
    paths = [
        f"periods/{pid}/",
        f"periods/{pid}/readiness/",
        f"periods/{pid}/population/",
        f"periods/{pid}/attendance/",
        f"periods/{pid}/inputs/",
        f"periods/{pid}/joiners-exits/",
        f"periods/{pid}/employee-actions/",
        f"periods/{pid}/overrides/",
        f"runs/{run['id']}/",
        f"runs/{run['id']}/results/",
        f"runs/{run['id']}/results/?tab=exceptions",
        f"runs/{run['id']}/exceptions/",
        f"runs/{run['id']}/payslips/",
        f"runs/{run['id']}/outputs/",
        f"runs/{run['id']}/checklist/",
        f"results/{result.pk}/",
        f"results/{result.pk}/trace/",
        f"components/{component.pk}/",
        f"components/{component.pk}/history/",
        f"salary-structures/{structure.pk}/",
        f"salary-structures/{structure.pk}/versions/",
        f"salary-structures/{structure.pk}/preview/?ctc=900000",
        f"employees/{nikhil.pk}/",
        f"employees/{nikhil.pk}/history/",
        f"compensations/history/?employee_id={nikhil.pk}",
        f"dashboard/?period={pid}",
    ] + [
        f"reports/{key}/?period={pid}"
        for key in (
            "register",
            "employee_summary",
            "department_summary",
            "earnings_deductions",
            "joiners",
            "exits",
            "revisions",
            "lop",
            "reimbursements",
            "variance",
            "ytd",
            "audit_trail",
        )
    ]
    for path in paths:
        response = admin.get(f"/api/v1/payroll/{path}")
        assert (
            response.status_code == 200
        ), f"GET {path}: {response.status_code} {response.content[:200]}"
