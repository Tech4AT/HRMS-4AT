"""Payroll run orchestration (API contract §2):

OPEN PERIOD → SNAPSHOT INPUTS → VALIDATE → CALCULATE → STORE RUN/RESULTS →
REVIEW → APPROVE → FINALIZE/LOCK → GENERATE OUTPUTS

A recalculation creates a new run; the previous draft run is superseded, a
finalized run is never modified (reopen marks it and its outputs superseded
and a new run is calculated)."""

import hashlib
import json
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from payroll import models as m
from payroll.engine.calculator import ENGINE_VERSION, calculate_employee
from payroll.engine.money import ZERO, D
from payroll.integrations import approvals_bridge, notify

from . import config as config_service
from . import people
from . import periods as period_service
from .common import (
    audit,
    blocking,
    conflict,
    employee_card,
    ensure_unlocked,
    forbidden,
    invalid,
    jsonable,
)

STAGE_PERMISSION = {"finance_review": "payroll.review", "final_approval": "payroll.approve"}


def _checksum(data) -> str:
    return hashlib.sha256(json.dumps(jsonable(data), sort_keys=True).encode()).hexdigest()


def current_run(period):
    return period.runs.filter(is_current=True).order_by("-run_no").first()


def previous_finalized_result(period, employee_id):
    return (
        m.EmployeePayrollResult.objects.filter(
            employee_id=employee_id,
            run__status="finalized",
            run__period__pay_group=period.pay_group,
            run__period__end_date__lt=period.start_date,
        )
        .order_by("-run__period__end_date", "-run__run_no")
        .first()
    )


def _compensations_ctx(employee, period):
    comps = (
        m.EmployeeCompensation.objects.filter(
            employee=employee, effective_from__lte=period.end_date
        )
        .exclude(status="cancelled")
        .select_related("structure")
        .order_by("effective_from")
    )
    data = []
    for comp in comps:
        if comp.effective_to and comp.effective_to < period.start_date:
            continue
        as_of = max(comp.effective_from, period.start_date)
        lines, version_no = config_service.lines_for(comp.structure, as_of)
        data.append(
            {
                "id": str(comp.pk),
                "version_no": comp.version_no,
                "effective_from": comp.effective_from,
                "effective_to": comp.effective_to,
                "annual_ctc": comp.annual_ctc,
                "structure_code": comp.structure.code,
                "structure_version": version_no,
                "lines": lines,
            }
        )
    return data


def _input_ctx(record):
    config = config_service.component_config(record.component)
    return {
        "id": str(record.pk),
        "input_type": record.input_type,
        "amount": record.amount,
        "units": record.units,
        "rate": record.rate,
        "component": config,
    }


@transaction.atomic
def calculate(period, actor, employee_ids=None, mode="DRAFT_RECALCULATION"):
    ensure_unlocked(period)
    existing = current_run(period)
    if existing and existing.status in ("submitted", "approved"):
        raise conflict(
            (
                "The current run is under approval. It must be "
                "returned or rejected before recalculating."
            ),
            code="PAY_INVALID_STATE",
        )
    pay_group = period.pay_group
    employees = list(period_service.population(period))
    if employee_ids:
        employees = [e for e in employees if str(e.pk) in {str(i) for i in employee_ids}]

    rules = config_service.statutory_rules_data()
    attendance_snapshot = (
        period_service.capture_snapshot(period, "attendance", actor)
        if period.attendance.exists()
        else None
    )
    employee_snapshot = period_service.capture_snapshot(period, "employee", actor)
    attendance = {a.employee_id: a for a in period.attendance.all()}
    inputs_qs = period.inputs.select_related("component")
    approved_inputs = {}
    for record in inputs_qs.filter(status__in=("approved", "included")):
        approved_inputs.setdefault(record.employee_id, []).append(record)
    overrides = {}
    for override in period.overrides.filter(is_active=True).select_related("component"):
        overrides.setdefault(override.employee_id, {})[override.component.code] = {
            "id": str(override.pk),
            "amount": override.override_amount,
            "reason": override.reason,
        }
    pay_group_ctx = {
        "proration_basis": pay_group.proration_basis,
        "mid_period_revision_policy": pay_group.mid_period_revision_policy,
        "net_pay_rounding": pay_group.net_pay_rounding,
    }
    period_ctx = {
        "start": period.start_date,
        "end": period.end_date,
        "year": period.year,
        "month": period.month,
        "working_days": period.working_days,
    }
    configuration = {
        "rules": rules,
        "pay_group": jsonable(pay_group_ctx),
        "engine_version": ENGINE_VERSION,
    }

    if existing and not existing.is_immutable:
        existing.is_current = False
        existing.status = "superseded"
        existing.save(update_fields=["is_current", "status"])
    elif existing:
        existing.is_current = False
        existing.save(update_fields=["is_current"])
    last = period.runs.order_by("-run_no").first()
    run = m.PayrollRun.objects.create(
        period=period,
        run_no=(last.run_no + 1) if last else 1,
        status="calculating",
        mode=mode,
        engine_version=ENGINE_VERSION,
        created_by=actor,
    )

    input_manifest = {
        "attendance": attendance_snapshot.checksum if attendance_snapshot else None,
        "employees": employee_snapshot.checksum,
        "inputs": sorted(
            (str(r.pk), str(r.amount), str(r.units), r.status)
            for rs in approved_inputs.values()
            for r in rs
        ),
        "overrides": jsonable(overrides),
    }
    configs_used = {}
    totals = {"gross": ZERO, "ded": ZERO, "net": ZERO, "cost": ZERO}
    counts = {"blocking": 0, "warning": 0, "info": 0}

    for employee in employees:
        profile = people.profile_for(employee, period.end_date)
        comps = _compensations_ctx(employee, period)
        for comp in comps:
            configs_used[f"{comp['structure_code']} v{comp['structure_version']}"] = comp["lines"]
        att = attendance.get(employee.pk)
        ctx = {
            "period": period_ctx,
            "pay_group": pay_group_ctx,
            "legal_entity_id": pay_group.legal_entity_id,
            "employee": {
                "id": employee.pk,
                "date_of_joining": employee.date_of_joining,
                "date_of_exit": employee.date_of_exit,
            },
            "profile": (
                None
                if profile is None
                else {
                    "payroll_start_date": profile.payroll_start_date,
                    "payroll_end_date": profile.payroll_end_date,
                    "pf_applicable": profile.pf_applicable,
                    "esi_applicable": profile.esi_applicable,
                    "pt_applicable": profile.pt_applicable,
                    "lwf_applicable": profile.lwf_applicable,
                    "work_state": profile.work_state,
                }
            ),
            "compensations": comps,
            "attendance": (
                None
                if att is None
                else {
                    "working_days": att.working_days,
                    "payable_days": att.payable_days,
                    "lop_days": att.lop_days,
                    "status": att.status,
                }
            ),
            "inputs": [_input_ctx(r) for r in approved_inputs.get(employee.pk, [])],
            "overrides": overrides.get(employee.pk, {}),
            "rules": rules,
        }
        calc = calculate_employee(ctx)
        exceptions = list(calc["exceptions"])
        exceptions.extend(
            _employee_validations(
                period, employee, profile, att, approved_inputs.get(employee.pk, [])
            )
        )
        on_hold = period_service.is_on_hold(period, employee.pk) or (
            profile and profile.payroll_status == "on_hold"
        )
        if on_hold:
            exceptions.append(
                {
                    "severity": "info",
                    "rule_code": "SALARY_ON_HOLD",
                    "message": "Salary is on hold: calculated, but excluded from payment.",
                }
            )

        previous = previous_finalized_result(period, employee.pk)
        variance_amount = variance_pct = None
        if previous is not None:
            variance_amount = calc["net_pay"] - previous.net_pay
            if previous.net_pay:
                variance_pct = (variance_amount * 100 / previous.net_pay).quantize(Decimal("0.01"))
                if abs(variance_pct) > pay_group.variance_threshold_pct:
                    exceptions.append(
                        {
                            "severity": "warning",
                            "rule_code": "NET_PAY_VARIANCE",
                            "message": f"Net pay changed {variance_pct}% vs the previous payroll "
                            f"({previous.net_pay} → {calc['net_pay']}).",
                            "details": {
                                "previous": str(previous.net_pay),
                                "current": str(calc["net_pay"]),
                                "change": str(variance_amount),
                                "pct": str(variance_pct),
                                "drivers": _variance_drivers(previous, calc),
                            },
                        }
                    )

        severities = {e["severity"] for e in exceptions}
        status = (
            "error"
            if "blocking" in severities
            else ("on_hold" if on_hold else ("warning" if "warning" in severities else "ready"))
        )
        card = employee_card(employee)
        bank = getattr(employee, "payroll_payment_info", None)
        card["bank_account_last4"] = (bank.bank_account_number or "")[-4:] if bank else ""
        card["bank_name"] = bank.bank_name if bank else ""
        card["pay_group"] = pay_group.name
        result = m.EmployeePayrollResult.objects.create(
            run=run,
            employee=employee,
            compensation_id=calc.get("compensation_id"),
            employee_snapshot=card,
            working_days=calc["working_days"],
            payable_days=calc["payable_days"],
            lop_days=calc["lop_days"],
            gross_earnings=calc["gross_earnings"],
            total_deductions=calc["total_deductions"],
            net_pay=calc["net_pay"],
            employer_contributions=calc["employer_contributions"],
            employer_cost=calc["employer_cost"],
            validation_status=status,
            is_on_hold=bool(on_hold),
            is_joiner=calc["is_joiner"],
            is_exit=calc["is_exit"],
            has_revision=calc["has_revision"],
            previous_net_pay=previous.net_pay if previous else None,
            variance_amount=variance_amount,
            variance_pct=variance_pct,
            segments=calc["segments"],
        )
        m.PayrollResultComponent.objects.bulk_create(
            [
                m.PayrollResultComponent(
                    result=result,
                    component_id=line["component_id"],
                    component_code=line["component_code"],
                    component_name=line["component_name"],
                    component_type=line["component_type"],
                    sequence=line["sequence"],
                    amount=line["amount"],
                    pre_round_amount=line["pre_round_amount"],
                    calculated_amount=line["calculated_amount"],
                    is_overridden=line["is_overridden"],
                    is_taxable=line["is_taxable"],
                    show_on_payslip=line["show_on_payslip"],
                    calculation_basis=line["calculation_basis"],
                    formula=line["formula"],
                    inputs=jsonable(line["inputs"]),
                    rule_version=line["rule_version"],
                    source_refs=line["source_refs"],
                    dependencies=line["dependencies"],
                    override_ref=line["override_ref"],
                )
                for line in calc["lines"]
            ]
        )
        _store_exceptions(run, result, employee, exceptions, counts)
        totals["gross"] += calc["gross_earnings"]
        totals["ded"] += calc["total_deductions"]
        totals["net"] += calc["net_pay"]
        totals["cost"] += calc["employer_cost"]

    run_exceptions = []
    if not employees:
        run_exceptions.append(
            {
                "severity": "blocking",
                "rule_code": "NO_EMPLOYEES",
                "message": "No payroll-eligible employees in this pay group for the period.",
            }
        )
    pending = inputs_qs.filter(status__in=("pending", "draft")).count()
    if pending:
        run_exceptions.append(
            {
                "severity": "warning",
                "rule_code": "PENDING_INPUTS",
                "message": (
                    f"{pending} payroll input(s) are awaiting " "approval and were not included."
                ),
            }
        )
    unreviewed = [r["code"] for r in rules if r["status"] == "active" and not r["is_reviewed"]]
    if unreviewed:
        run_exceptions.append(
            {
                "severity": "warning",
                "rule_code": "STATUTORY_UNREVIEWED",
                "message": "Statutory rules not yet signed off by payroll/compliance: "
                f"{', '.join(sorted(set(unreviewed)))}. "
                "Do not rely on them for production payroll.",
            }
        )
    _store_exceptions(run, None, None, run_exceptions, counts)

    configuration["structures"] = configs_used
    run.configuration_snapshot = jsonable(configuration)
    run.configuration_snapshot_id = _checksum(configuration)[:32]
    run.input_snapshot_id = _checksum(input_manifest)[:32]
    run.employee_count = len(employees)
    run.gross_total = totals["gross"]
    run.deduction_total = totals["ded"]
    run.net_total = totals["net"]
    run.employer_cost_total = totals["cost"]
    run.error_count, run.warning_count, run.info_count = (
        counts["blocking"],
        counts["warning"],
        counts["info"],
    )
    run.status = "validation_failed" if counts["blocking"] else "ready"
    run.calculated_at = timezone.now()
    run.save()
    period.status = "ready_for_review" if run.status == "ready" else "in_progress"
    period.save(update_fields=["status", "updated_at"])
    audit(
        actor,
        "run.calculated",
        run,
        period=str(period),
        run_no=run.run_no,
        employees=len(employees),
        errors=counts["blocking"],
        warnings=counts["warning"],
        input_snapshot_id=run.input_snapshot_id,
        configuration_snapshot_id=run.configuration_snapshot_id,
    )
    return run


def _store_exceptions(run, result, employee, exceptions, counts):
    rows = []
    for exc in exceptions:
        counts[exc["severity"]] = counts.get(exc["severity"], 0) + 1
        rows.append(
            m.PayrollException(
                run=run,
                result=result,
                employee=employee,
                severity=exc["severity"],
                rule_code=exc["rule_code"],
                message=exc["message"][:500],
                details=jsonable(exc.get("details", {})),
            )
        )
    m.PayrollException.objects.bulk_create(rows)


def _employee_validations(period, employee, profile, att, inputs):
    out = []
    policy = period.pay_group.attendance_policy
    if profile is None:
        out.append(
            {
                "severity": "blocking",
                "rule_code": "MISSING_PAYROLL_PROFILE",
                "message": "Mandatory payroll profile is missing.",
            }
        )
    else:
        missing = people.missing_profile_fields(employee, profile)
        if missing:
            out.append(
                {
                    "severity": "warning",
                    "rule_code": "MISSING_PAYROLL_DATA",
                    "message": f"Missing {', '.join(missing)}.",
                    "details": {"missing": missing},
                }
            )
    if att is None:
        out.append(
            {
                "severity": "blocking" if policy == "block" else "warning",
                "rule_code": "MISSING_ATTENDANCE",
                "message": (
                    "No finalized attendance for this " "period; full payable days were assumed."
                ),
            }
        )
    elif att.status != "final":
        out.append(
            {
                "severity": "blocking" if policy == "block" else "warning",
                "rule_code": "ATTENDANCE_NOT_FINAL",
                "message": "Attendance for this period is not finalized.",
            }
        )
    if att is not None and att.pending_leave_requests:
        out.append(
            {
                "severity": "warning",
                "rule_code": "PENDING_LEAVE",
                "message": f"{att.pending_leave_requests} leave request(s) still pending approval.",
            }
        )
    threshold = period.pay_group.large_input_threshold
    seen = {}
    for record in inputs:
        if record.amount and record.amount > threshold:
            out.append(
                {
                    "severity": "warning",
                    "rule_code": "LARGE_INPUT",
                    "message": f"Large {record.get_input_type_display().lower()}: {record.amount} "
                    f"(threshold {threshold}).",
                }
            )
        key = (record.component_id, record.input_type, record.amount, record.units)
        if key in seen:
            out.append(
                {
                    "severity": "warning",
                    "rule_code": "DUPLICATE_INPUT",
                    "message": f"Possible duplicate {record.get_input_type_display().lower()} "
                    f"of {record.amount or record.units} for {record.component.code}.",
                }
            )
        seen[key] = record
    return out


def _variance_drivers(previous, calc):
    before = {ln.component_code: ln.amount for ln in previous.lines.all()}
    after = {ln["component_code"]: ln["amount"] for ln in calc["lines"]}
    drivers = []
    for code in sorted(set(before) | set(after)):
        change = D(after.get(code)) - D(before.get(code))
        if change:
            drivers.append(
                {
                    "component": code,
                    "previous": str(D(before.get(code))),
                    "current": str(D(after.get(code))),
                    "change": str(change),
                }
            )
    drivers.sort(key=lambda d: -abs(D(d["change"])))
    return drivers[:5]


# ------------------------------------------------------------------ workflow


def _allow_self_approval():
    return getattr(settings, "PAYROLL_ALLOW_SELF_APPROVAL", False)


@transaction.atomic
def acknowledge_exception(exception, actor, note):
    if exception.severity == "blocking":
        raise invalid("Blocking errors cannot be acknowledged; fix the cause and recalculate.")
    if exception.run.is_immutable or exception.run.status in ("submitted", "approved"):
        raise conflict("This run can no longer be changed.", code="PAY_INVALID_STATE")
    if not (note or "").strip():
        raise invalid(
            "Add a note explaining why this warning is acceptable.", {"note": ["Required."]}
        )
    exception.status = "acknowledged"
    exception.resolution_note = note
    exception.acknowledged_by = actor
    exception.acknowledged_at = timezone.now()
    exception.save()
    audit(actor, "exception.acknowledged", exception, reason=note, rule_code=exception.rule_code)
    return exception


@transaction.atomic
def submit(run, actor):
    ensure_unlocked(run.period)
    if not run.is_current or run.status != "ready":
        raise conflict(
            (
                "Only the current run with no blocking errors can "
                "be submitted. Resolve errors and recalculate."
            ),
            code="PAY_INVALID_STATE",
        )
    if run.exceptions.filter(severity="blocking", status="open").exists():
        raise blocking("Blocking errors must be resolved first.")
    if run.period.pay_group.require_warning_acknowledgement:
        open_warnings = run.exceptions.filter(severity="warning", status="open")
        if open_warnings.exists():
            raise blocking(
                (
                    f"{open_warnings.count()} warning(s) must be "
                    "reviewed and acknowledged before submitting."
                ),
                [
                    {"id": str(e.pk), "rule_code": e.rule_code, "message": e.message}
                    for e in open_warnings[:50]
                ],
            )
    run.approvals.filter(status="pending").update(status="cancelled")
    m.PayrollApproval.objects.create(
        run=run,
        stage="prepared",
        sequence=0,
        status="approved",
        approver=actor,
        acted_at=timezone.now(),
        comments="Prepared and submitted",
    )
    for index, stage in enumerate(run.period.pay_group.stages(), start=1):
        m.PayrollApproval.objects.create(run=run, stage=stage, sequence=index)
    run.status = "submitted"
    run.submitted_by = actor
    run.submitted_at = timezone.now()
    run.save()
    run.period.status = "pending_approval"
    run.period.save(update_fields=["status", "updated_at"])
    audit(actor, "run.submitted", run)
    approvals_bridge.open_next_stage(run)
    return run


@transaction.atomic
def decide(run, actor, decision, comments, has_permission, from_inbox=False):
    if run.status != "submitted":
        raise conflict("This run is not awaiting approval.", code="PAY_INVALID_STATE")
    stage = run.approvals.filter(status="pending").order_by("sequence").first()
    if stage is None:
        raise conflict("No approval stage is pending.", code="PAY_INVALID_STATE")
    if not has_permission(actor, STAGE_PERMISSION.get(stage.stage, "payroll.approve")):
        raise forbidden(f"You are not an approver for the {stage.get_stage_display()} stage.")
    if run.submitted_by_id == actor.pk and not _allow_self_approval():
        raise forbidden("Maker-checker: the person who submitted this payroll cannot approve it.")
    if (
        run.approvals.filter(status="approved", approver=actor, sequence__gt=0).exists()
        and not _allow_self_approval()
    ):
        raise forbidden("You have already approved an earlier stage of this payroll.")
    if decision not in ("approve", "reject", "return"):
        raise invalid("Decision must be approve, reject or return.")
    if decision != "approve" and not (comments or "").strip():
        raise invalid(
            "A comment is required to reject or return a payroll.", {"comments": ["Required."]}
        )
    stage.status = {"approve": "approved", "reject": "rejected", "return": "returned"}[decision]
    stage.approver = actor
    stage.comments = comments or ""
    stage.acted_at = timezone.now()
    stage.save()
    if not from_inbox:
        approvals_bridge.close_stage(
            stage, actor, "approve" if decision == "approve" else "reject", comments
        )
    period = run.period
    if decision == "approve":
        if not run.approvals.filter(status="pending").exists():
            run.status = "approved"
            period.status = "approved"
    else:
        run.approvals.filter(status="pending").update(status="cancelled")
        run.status = "rejected" if decision == "reject" else "returned"
        period.status = "in_progress"
    run.save()
    period.save(update_fields=["status", "updated_at"])
    audit(actor, f"run.{stage.stage}.{stage.status}", run, reason=comments)
    if decision == "approve":
        approvals_bridge.open_next_stage(run)
    return run


@transaction.atomic
def finalize(run, actor):
    """Transactional: either every employee result is locked as the official
    payroll, or nothing is (API contract §14)."""
    period = m.PayrollPeriod.objects.select_for_update().get(pk=run.period_id)
    run = m.PayrollRun.objects.select_for_update().get(pk=run.pk)
    if run.status == "finalized":
        return run
    if run.status != "approved" or not run.is_current:
        raise conflict(
            "Only the current, fully approved run can be finalized.", code="PAY_INVALID_STATE"
        )
    if run.exceptions.filter(severity="blocking", status="open").exists():
        raise blocking("Blocking errors prevent finalization.")
    now = timezone.now()
    run.status = "finalized"
    run.finalized_by = actor
    run.finalized_at = now
    run.save()
    period.inputs.filter(status="approved").update(status="included")
    period.status = "finalized"
    period.finalized_by = actor
    period.finalized_at = now
    period.save()
    audit(
        actor,
        "run.finalized",
        run,
        period=str(period),
        net_total=run.net_total,
        input_snapshot_id=run.input_snapshot_id,
    )
    notify.run_finalized(run)
    return run


@transaction.atomic
def reopen(run, actor, reason):
    if not (reason or "").strip():
        raise invalid("A reason is mandatory to reopen payroll.", {"reason": ["Required."]})
    if run.status != "finalized":
        raise conflict("Only a finalized payroll can be reopened.", code="PAY_INVALID_STATE")
    period = run.period
    now = timezone.now()
    run.status = "reopened"
    run.reopened_by = actor
    run.reopened_at = now
    run.reopen_reason = reason
    run.save()
    superseded_payslips = (
        m.Payslip.objects.filter(result__run=run)
        .exclude(status="superseded")
        .update(status="superseded", superseded_at=now)
    )
    superseded_outputs = run.outputs.exclude(status="superseded").update(status="superseded")
    period.inputs.filter(status="included").update(status="approved")
    period.status = "reopened"
    period.completed_at = None
    period.save()
    audit(
        actor,
        "run.reopened",
        run,
        reason=reason,
        payslips_superseded=superseded_payslips,
        outputs_superseded=superseded_outputs,
    )
    return run
