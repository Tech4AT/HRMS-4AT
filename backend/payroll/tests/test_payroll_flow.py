"""End-to-end API tests mapped to the UAT tracker (UAT-001..015): each role
acts through the real endpoints, so RBAC, maker-checker, locking and audit are
exercised the way the UI uses them."""

import datetime
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditLog
from employees.models import Employee
from payroll import models as m

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    with override_settings(DEBUG=True):
        call_command("seed_payroll", "--demo", verbosity=0)


def client_for(email):
    client = APIClient()
    client.force_authenticate(User.objects.get(email=email))
    return client


@pytest.fixture
def admin(seeded):
    return client_for("payroll.admin@demo.4at")


@pytest.fixture
def reviewer(seeded):
    return client_for("finance.reviewer@demo.4at")


@pytest.fixture
def approver(seeded):
    return client_for("payroll.approver@demo.4at")


def data(response, status=200):
    assert response.status_code == status, response.content
    return response.json()["data"]


def test_uat_001_create_component_and_version_history(admin):
    body = data(
        admin.post(
            "/api/v1/payroll/components/",
            {
                "code": "SHIFT_ALLOW",
                "name": "Shift Allowance",
                "component_type": "earning",
                "category": "variable",
                "calculation_type": "fixed",
                "value": "2000",
                "effective_from": "2026-09-01",
                "is_taxable": True,
            },
            format="json",
        ),
        201,
    )
    assert body["status"] == "active" and body["version"] == 1
    listed = data(admin.get("/api/v1/payroll/components/?status=active&search=SHIFT"))
    assert [c["code"] for c in listed] == ["SHIFT_ALLOW"]

    stale = admin.patch(
        f"/api/v1/payroll/components/{body['id']}/", {"value": "2500", "version": 0}, format="json"
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "PAY_VERSION_CONFLICT"
    updated = data(
        admin.patch(
            f"/api/v1/payroll/components/{body['id']}/",
            {"value": "2500", "version": 1, "reason": "Policy change"},
            format="json",
        )
    )
    assert updated["version"] == 2
    history = data(admin.get(f"/api/v1/payroll/components/{body['id']}/history/"))
    assert [v["version"] for v in history["versions"]] == [2, 1]
    assert AuditLog.objects.filter(
        action="payroll.component.updated", entity_id=body["id"]
    ).exists()


def test_component_in_active_structure_cannot_be_deactivated(admin):
    basic = m.SalaryComponent.objects.get(code="BASIC")
    response = admin.post(f"/api/v1/payroll/components/{basic.pk}/deactivate/", {}, format="json")
    assert (
        response.status_code == 409 and response.json()["error"]["code"] == "PAY_COMPONENT_IN_USE"
    )


def test_uat_002_invalid_formula_and_reconciliation_are_blocked(admin):
    bad = admin.post(
        "/api/v1/payroll/components/",
        {
            "code": "BAD",
            "name": "Bad",
            "component_type": "earning",
            "calculation_type": "formula",
            "formula_expr": "NOPE * 2",
            "effective_from": "2026-09-01",
        },
        format="json",
    )
    assert bad.status_code == 400 and "formula_expr" in bad.json()["error"]["fields"]
    preview = data(
        admin.post(
            "/api/v1/payroll/salary-structures/preview/",
            {
                "annual_ctc": 1200000,
                "lines": [{"component_code": "BASIC"}, {"component_code": "HRA"}],
            },
            format="json",
        )
    )
    assert preview["valid"] is False and "reconcile" in preview["errors"][0]


def test_employee_cannot_read_configuration(seeded):
    employee = client_for("nikhil.kommineni@demo.4at")
    assert employee.get("/api/v1/payroll/components/").status_code == 403


def test_uat_003_004_assign_and_approve_revision_preserves_history(admin, reviewer, approver):
    nikhil = Employee.objects.get(employee_code="4AT-002")
    structure = m.SalaryStructure.objects.get(code="GS-IND-001")
    preview = data(
        admin.post(
            "/api/v1/payroll/compensations/preview/",
            {
                "employee": nikhil.pk,
                "structure": str(structure.pk),
                "annual_ctc": 1440000,
                "effective_from": "2026-10-01",
            },
            format="json",
        )
    )
    assert preview["current"] is not None and preview["proposed"]["valid"]

    revision = data(
        admin.post(
            "/api/v1/payroll/compensations/",
            {
                "employee": nikhil.pk,
                "structure": str(structure.pk),
                "annual_ctc": 1440000,
                "effective_from": "2026-10-01",
                "revision_type": "annual_revision",
                "reason": "Annual appraisal",
                "submit": True,
            },
            format="json",
        ),
        201,
    )
    assert revision["status"] == "pending_approval"
    rid = revision["id"]
    # final approver cannot skip the Finance review stage
    assert (
        approver.post(
            f"/api/v1/payroll/compensations/{rid}/decide/", {"decision": "approve"}, format="json"
        ).status_code
        == 403
    )
    data(
        reviewer.post(
            f"/api/v1/payroll/compensations/{rid}/decide/", {"decision": "approve"}, format="json"
        )
    )
    done = data(
        approver.post(
            f"/api/v1/payroll/compensations/{rid}/decide/", {"decision": "approve"}, format="json"
        )
    )
    assert done["status"] == "approved"
    comps = list(m.EmployeeCompensation.objects.filter(employee=nikhil).order_by("effective_from"))
    assert len(comps) == 2
    assert comps[0].effective_to == datetime.date(2026, 9, 30) and comps[0].annual_ctc == Decimal(
        "1200000"
    )
    assert comps[1].annual_ctc == Decimal("1440000") and comps[1].effective_to is None


def test_sensitive_values_are_masked_for_reviewer(admin, reviewer):
    nikhil = Employee.objects.get(employee_code="4AT-002")
    masked = data(reviewer.get(f"/api/v1/payroll/employees/{nikhil.pk}/"))
    assert masked["bank"]["bank_account_number"].startswith("XXXX")
    full = data(admin.get(f"/api/v1/payroll/employees/{nikhil.pk}/"))
    assert not full["bank"]["bank_account_number"].startswith("X")


def run_september(admin):
    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    period = data(
        admin.post(
            "/api/v1/payroll/periods/",
            {"pay_group": str(group.pk), "year": 2026, "month": 9},
            format="json",
        ),
        201,
    )
    pid = period["id"]
    data(admin.post(f"/api/v1/payroll/periods/{pid}/attendance/fill-missing/", {}, format="json"))
    nikhil = Employee.objects.get(employee_code="4AT-002")
    data(
        admin.put(
            f"/api/v1/payroll/periods/{pid}/attendance/{nikhil.pk}/",
            {"lop_days": 1, "payable_days": 29, "working_days": 30, "status": "final"},
            format="json",
        )
    )
    return pid, nikhil


def test_full_monthly_cycle(admin, reviewer, approver, seeded):
    pid, nikhil = run_september(admin)
    bonus = m.SalaryComponent.objects.get(code="BONUS")
    created = data(
        admin.post(
            f"/api/v1/payroll/periods/{pid}/inputs/",
            {
                "employee": nikhil.pk,
                "input_type": "bonus",
                "component": str(bonus.pk),
                "amount": "10000",
                "reason": "Spot award",
            },
            format="json",
        ),
        201,
    )
    # maker-checker on inputs: the reviewer approves what the admin entered
    data(
        reviewer.post(
            f"/api/v1/payroll/periods/{pid}/inputs/{created['id']}/decide/",
            {"decision": "approve"},
            format="json",
        )
    )

    run = data(
        admin.post(
            f"/api/v1/payroll/periods/{pid}/calculate/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="calc-1",
        ),
        201,
    )
    replay = admin.post(
        f"/api/v1/payroll/periods/{pid}/calculate/",
        {},
        format="json",
        HTTP_IDEMPOTENCY_KEY="calc-1",
    )
    assert replay.json()["data"]["id"] == run["id"]  # retried request does not create a second run
    assert m.PayrollRun.objects.filter(period_id=pid).count() == 1

    results = data(admin.get(f"/api/v1/payroll/runs/{run['id']}/results/"))
    by_code = {r["employee"]["employee_code"]: r for r in results}
    assert set(by_code) == {f"4AT-00{i}" for i in range(1, 9)}
    nik = data(admin.get(f"/api/v1/payroll/results/{by_code['4AT-002']['id']}/trace/"))
    lines = {ln["component_code"]: ln for ln in nik["lines"]}
    assert Decimal(lines["BASIC"]["amount"]) == Decimal("43500.00")  # 1 LOP day
    assert Decimal(lines["BONUS"]["amount"]) == Decimal("10000.00")
    assert "LOP" in lines["BASIC"]["formula"] and nik["run"]["input_snapshot_id"]
    assert by_code["4AT-006"]["is_joiner"] and by_code["4AT-004"]["is_exit"]

    # warnings (unreviewed statutory rules) must be acknowledged before submit
    blocked = admin.post(f"/api/v1/payroll/runs/{run['id']}/submit/", {}, format="json")
    assert (
        blocked.status_code == 422 and blocked.json()["error"]["code"] == "PAY_BLOCKING_VALIDATION"
    )
    for exc in data(admin.get(f"/api/v1/payroll/runs/{run['id']}/exceptions/?severity=warning")):
        data(
            admin.post(
                f"/api/v1/payroll/exceptions/{exc['id']}/acknowledge/",
                {"note": "Reviewed for UAT"},
                format="json",
            )
        )
    data(admin.post(f"/api/v1/payroll/runs/{run['id']}/submit/", {}, format="json"))

    # UAT-012: Finance rejects -> cannot finalize; must recalculate and resubmit
    assert (
        admin.post(
            f"/api/v1/payroll/runs/{run['id']}/approvals/", {"decision": "approve"}, format="json"
        ).status_code
        == 403
    )  # preparer can't approve
    rejected = reviewer.post(
        f"/api/v1/payroll/runs/{run['id']}/approvals/", {"decision": "reject"}, format="json"
    )
    assert rejected.status_code == 400  # comment required
    data(
        reviewer.post(
            f"/api/v1/payroll/runs/{run['id']}/approvals/",
            {"decision": "return", "comments": "Check the bonus"},
            format="json",
        )
    )
    assert (
        approver.post(f"/api/v1/payroll/runs/{run['id']}/finalize/", {}, format="json").status_code
        == 409
    )

    run2 = data(admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json"), 201)
    assert run2["run_no"] == 2
    for exc in data(admin.get(f"/api/v1/payroll/runs/{run2['id']}/exceptions/?severity=warning")):
        data(
            admin.post(
                f"/api/v1/payroll/exceptions/{exc['id']}/acknowledge/",
                {"note": "ok"},
                format="json",
            )
        )
    data(admin.post(f"/api/v1/payroll/runs/{run2['id']}/submit/", {}, format="json"))
    data(
        reviewer.post(
            f"/api/v1/payroll/runs/{run2['id']}/approvals/", {"decision": "approve"}, format="json"
        )
    )
    final = data(
        approver.post(
            f"/api/v1/payroll/runs/{run2['id']}/approvals/", {"decision": "approve"}, format="json"
        )
    )
    assert final["status"] == "approved"

    # UAT-013: finalize locks the period
    data(approver.post(f"/api/v1/payroll/runs/{run2['id']}/finalize/", {}, format="json"))
    locked = admin.post(
        f"/api/v1/payroll/periods/{pid}/inputs/",
        {
            "employee": nikhil.pk,
            "input_type": "bonus",
            "component": str(bonus.pk),
            "amount": "1",
            "reason": "late",
        },
        format="json",
    )
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "PAY_PERIOD_LOCKED"
    assert m.PayrollInput.objects.get(pk=created["id"]).status == "included"

    # UAT-015: payslips generated, released, and only visible to their owner
    assert (
        data(
            admin.post(f"/api/v1/payroll/runs/{run2['id']}/payslips/generate/", {}, format="json")
        )["generated"]
        >= 7
    )
    data(admin.post(f"/api/v1/payroll/runs/{run2['id']}/payslips/release/", {}, format="json"))
    me = client_for("nikhil.kommineni@demo.4at")
    mine = data(me.get("/api/v1/payroll/my/payslips/"))
    assert len(mine) == 1 and mine[0]["employee"]["employee_code"] == "4AT-002"
    other = m.Payslip.objects.exclude(employee=nikhil).first()
    assert me.get(f"/api/v1/payroll/my/payslips/{other.pk}/").status_code == 403
    assert me.get(f"/api/v1/payroll/payslips/{other.pk}/").status_code == 403

    bank = data(
        admin.post(
            f"/api/v1/payroll/runs/{run2['id']}/outputs/", {"kind": "bank_advice"}, format="json"
        ),
        201,
    )
    assert bank["record_count"] >= 7

    # UAT-014: reopen needs the privileged role and a reason; outputs are superseded
    assert (
        approver.post(
            f"/api/v1/payroll/runs/{run2['id']}/reopen/", {"reason": "x"}, format="json"
        ).status_code
        == 403
    )
    hr = client_for("hr.admin@demo.4at")
    assert (
        hr.post(f"/api/v1/payroll/runs/{run2['id']}/reopen/", {}, format="json").status_code == 400
    )
    data(
        hr.post(
            f"/api/v1/payroll/runs/{run2['id']}/reopen/",
            {"reason": "Bank file correction"},
            format="json",
        )
    )
    assert (
        not m.Payslip.objects.filter(result__run_id=run2["id"])
        .exclude(status="superseded")
        .exists()
    )
    assert AuditLog.objects.filter(action="payroll.run.reopened").exists()


def test_uat_007_duplicate_import_rows_are_rejected(admin, seeded):
    pid, _ = run_september(admin)
    csv = (
        "row_key,employee_code,input_type,component_code,amount,reason\n"
        "r1,4AT-002,bonus,BONUS,5000,Q2\n"
    )
    first = data(
        admin.post(
            f"/api/v1/payroll/periods/{pid}/inputs/import/",
            {"csv": csv, "batch_id": "B1"},
            format="json",
        )
    )
    again = data(
        admin.post(
            f"/api/v1/payroll/periods/{pid}/inputs/import/",
            {"csv": csv, "batch_id": "B1"},
            format="json",
        )
    )
    assert first["imported"] == 1 and again["imported"] == 0 and again["errors"]


def test_uat_010_missing_structure_blocks(admin, seeded):
    pid, _ = run_september(admin)
    m.EmployeeCompensation.objects.filter(employee__employee_code="4AT-008").update(
        status="cancelled"
    )
    run = data(admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json"), 201)
    assert run["status"] == "validation_failed"
    errors = data(admin.get(f"/api/v1/payroll/runs/{run['id']}/exceptions/?severity=blocking"))
    assert any(e["rule_code"] == "NO_COMPENSATION" for e in errors)
    assert (
        admin.post(f"/api/v1/payroll/runs/{run['id']}/submit/", {}, format="json").status_code
        == 409
    )


def test_dashboard_and_reports(admin, seeded):
    pid, _ = run_september(admin)
    data(admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json"), 201)
    dash = data(admin.get(f"/api/v1/payroll/dashboard/?period={pid}"))
    assert dash["period"]["id"] == pid and len(dash["steps"]) == 6 and dash["kpis"]
    register = data(admin.get(f"/api/v1/payroll/reports/register/?period={pid}"))
    assert len(register["rows"]) == 8 and "BASIC" in [c["key"] for c in register["columns"]]
    auditor = client_for("auditor@demo.4at")
    assert data(auditor.get("/api/v1/payroll/audit/"))
    assert (
        auditor.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json").status_code
        == 403
    )


def test_uat_011_net_pay_variance_is_flagged(admin, reviewer, seeded):
    pid, nikhil = run_september(admin)
    september = data(
        admin.post(f"/api/v1/payroll/periods/{pid}/calculate/", {}, format="json"), 201
    )
    # Only the previous run's finalized status matters for the comparison.
    m.PayrollRun.objects.filter(pk=september["id"]).update(status="finalized")
    previous = m.EmployeePayrollResult.objects.get(run_id=september["id"], employee=nikhil)

    group = m.PayGroup.objects.get(code="MONTHLY-IN")
    october = data(
        admin.post(
            "/api/v1/payroll/periods/",
            {"pay_group": str(group.pk), "year": 2026, "month": 10},
            format="json",
        ),
        201,
    )["id"]
    data(
        admin.post(f"/api/v1/payroll/periods/{october}/attendance/fill-missing/", {}, format="json")
    )
    bonus = data(
        admin.post(
            f"/api/v1/payroll/periods/{october}/inputs/",
            {
                "employee": nikhil.pk,
                "input_type": "bonus",
                "component": str(m.SalaryComponent.objects.get(code="BONUS").pk),
                "amount": "40000",
                "reason": "Festival bonus",
            },
            format="json",
        ),
        201,
    )
    data(
        reviewer.post(
            f"/api/v1/payroll/periods/{october}/inputs/{bonus['id']}/decide/",
            {"decision": "approve"},
            format="json",
        )
    )
    run = data(admin.post(f"/api/v1/payroll/periods/{october}/calculate/", {}, format="json"), 201)

    result = m.EmployeePayrollResult.objects.get(run_id=run["id"], employee=nikhil)
    assert result.variance_amount == result.net_pay - previous.net_pay
    assert result.variance_pct > group.variance_threshold_pct
    flagged = [
        e
        for e in data(admin.get(f"/api/v1/payroll/runs/{run['id']}/exceptions/?severity=warning"))
        if e["rule_code"] == "NET_PAY_VARIANCE"
    ]
    by_code = {e["employee"]["employee_code"]: e for e in flagged}
    # Nikhil (bonus) and 4AT-006 (September joiner, full October) moved > 10%;
    # an employee with identical pay both months is not flagged.
    assert set(by_code) == {"4AT-002", "4AT-006"}
    details = by_code["4AT-002"]["details"]
    assert Decimal(details["previous"]) == previous.net_pay
    assert Decimal(details["current"]) == result.net_pay
    assert Decimal(details["pct"]) == result.variance_pct
