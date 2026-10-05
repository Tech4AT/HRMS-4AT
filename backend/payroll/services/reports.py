"""PRD §11 MVP reports and the payroll dashboard (UI 01/12)."""

import datetime

from django.db.models import Count, Q, Sum

from audit.models import AuditLog
from payroll import models as m
from payroll.engine.money import ZERO, money_str, pct

from . import periods as period_service
from .common import employee_card, month_bounds

REPORTS = {
    "register": "Payroll Register",
    "employee_summary": "Employee Payroll Summary",
    "department_summary": "Department Payroll Summary",
    "earnings_deductions": "Earnings & Deductions Report",
    "joiners": "New Joiner Report",
    "exits": "Exit Report",
    "revisions": "Salary Revision Report",
    "lop": "LOP Report",
    "reimbursements": "Reimbursement Report",
    "variance": "Payroll Variance Report",
    "ytd": "YTD Payroll Summary",
    "audit_trail": "Audit Trail",
}


def official_run(period):
    """The finalized run if there is one, else the current draft run."""
    return (
        period.runs.filter(status="finalized").order_by("-run_no").first()
        or period.runs.filter(is_current=True).order_by("-run_no").first()
    )


def _col(key, label, kind="text"):
    return {"key": key, "label": label, "type": kind}


def _scoped(results, employee_ids):
    return results if employee_ids is None else results.filter(employee_id__in=employee_ids)


def build_report(key, period, employee_ids=None, params=None):
    params = params or {}
    run = official_run(period) if period else None
    title = REPORTS.get(key, key)
    meta = {
        "key": key,
        "title": title,
        "period": str(period) if period else "",
        "run_no": getattr(run, "run_no", None),
        "run_status": getattr(run, "status", None),
        "is_official": getattr(run, "status", None) == "finalized",
    }
    results = (
        _scoped(m.EmployeePayrollResult.objects.filter(run=run), employee_ids)
        .select_related("employee")
        .prefetch_related("lines")
        if run
        else m.EmployeePayrollResult.objects.none()
    )

    if key == "register":
        codes = []
        for r in results:
            for line in r.lines.all():
                if (line.component_code, line.component_type) not in codes:
                    codes.append((line.component_code, line.component_type))
        codes.sort(key=lambda c: ({"earning": 0, "deduction": 1}.get(c[1], 2), c[0]))
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("department", "Department"),
            _col("payable_days", "Payable Days", "number"),
            _col("lop_days", "LOP", "number"),
        ]
        columns += [_col(code, code, "money") for code, _ in codes]
        columns += [
            _col("gross", "Gross", "money"),
            _col("deductions", "Deductions", "money"),
            _col("net", "Net Pay", "money"),
            _col("employer_cost", "Employer Cost", "money"),
            _col("status", "Status"),
        ]
        rows = []
        for r in results:
            row = {
                "employee_code": r.employee.employee_code,
                "name": r.employee_snapshot.get("name"),
                "department": r.employee_snapshot.get("department"),
                "payable_days": str(r.payable_days),
                "lop_days": str(r.lop_days),
                "gross": money_str(r.gross_earnings),
                "deductions": money_str(r.total_deductions),
                "net": money_str(r.net_pay),
                "employer_cost": money_str(r.employer_cost),
                "status": r.validation_status,
            }
            for line in r.lines.all():
                row[line.component_code] = money_str(line.amount)
            rows.append(row)
        return {**meta, "columns": columns, "rows": rows, "totals": _totals(rows, columns)}

    if key == "employee_summary":
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("department", "Department"),
            _col("gross", "Gross", "money"),
            _col("deductions", "Deductions", "money"),
            _col("net", "Net Pay", "money"),
            _col("variance_pct", "Variance %", "number"),
        ]
        rows = [
            {
                "employee_code": r.employee.employee_code,
                "name": r.employee_snapshot.get("name"),
                "department": r.employee_snapshot.get("department"),
                "gross": money_str(r.gross_earnings),
                "deductions": money_str(r.total_deductions),
                "net": money_str(r.net_pay),
                "variance_pct": str(r.variance_pct) if r.variance_pct is not None else "",
            }
            for r in results
        ]
        return {**meta, "columns": columns, "rows": rows, "totals": _totals(rows, columns)}

    if key == "department_summary":
        groups = {}
        for r in results:
            dept = r.employee_snapshot.get("department") or "Unassigned"
            g = groups.setdefault(
                dept,
                {
                    "department": dept,
                    "employees": 0,
                    "gross": ZERO,
                    "deductions": ZERO,
                    "net": ZERO,
                    "employer_cost": ZERO,
                },
            )
            g["employees"] += 1
            g["gross"] += r.gross_earnings
            g["deductions"] += r.total_deductions
            g["net"] += r.net_pay
            g["employer_cost"] += r.employer_cost
        columns = [
            _col("department", "Department"),
            _col("employees", "Employees", "number"),
            _col("gross", "Gross", "money"),
            _col("deductions", "Deductions", "money"),
            _col("net", "Net Pay", "money"),
            _col("employer_cost", "Employer Cost", "money"),
        ]
        rows = [
            {
                **g,
                "gross": money_str(g["gross"]),
                "deductions": money_str(g["deductions"]),
                "net": money_str(g["net"]),
                "employer_cost": money_str(g["employer_cost"]),
            }
            for g in sorted(groups.values(), key=lambda g: g["department"])
        ]
        return {**meta, "columns": columns, "rows": rows, "totals": _totals(rows, columns)}

    if key == "earnings_deductions":
        agg = {}
        for r in results:
            for line in r.lines.all():
                a = agg.setdefault(
                    line.component_code,
                    {
                        "component": line.component_code,
                        "name": line.component_name,
                        "type": line.component_type,
                        "employees": 0,
                        "amount": ZERO,
                    },
                )
                a["employees"] += 1
                a["amount"] += line.amount
        columns = [
            _col("component", "Code"),
            _col("name", "Component"),
            _col("type", "Type"),
            _col("employees", "Employees", "number"),
            _col("amount", "Amount", "money"),
        ]
        rows = [
            {**a, "amount": money_str(a["amount"])}
            for a in sorted(
                agg.values(),
                key=lambda a: ({"earning": 0, "deduction": 1}.get(a["type"], 2), a["component"]),
            )
        ]
        return {**meta, "columns": columns, "rows": rows}

    if key in ("joiners", "exits"):
        joiners, exits = period_service.joiners_and_exits(period)
        items = joiners if key == "joiners" else exits
        by_emp = {r.employee_id: r for r in results}
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("department", "Department"),
            _col("date", "DOJ" if key == "joiners" else "LWD", "date"),
            _col("payable_days", "Payable Days", "number"),
            _col("net", "Net Pay", "money"),
            _col("decision", "Decision"),
        ]
        rows = []
        for employee, date, action in items:
            if employee_ids is not None and employee.pk not in employee_ids:
                continue
            r = by_emp.get(employee.pk)
            card = employee_card(employee)
            rows.append(
                {
                    "employee_code": card["employee_code"],
                    "name": card["name"],
                    "department": card["department"],
                    "date": date.isoformat(),
                    "payable_days": str(r.payable_days) if r else "",
                    "net": money_str(r.net_pay) if r else "",
                    "decision": action.decision if action else "process",
                }
            )
        return {**meta, "columns": columns, "rows": rows}

    if key == "revisions":
        revisions = m.CompensationRevision.objects.select_related("employee__user", "structure")
        if period:
            revisions = revisions.filter(
                effective_from__lte=period.end_date,
                effective_from__gte=period.start_date - datetime.timedelta(days=365),
            )
        if employee_ids is not None:
            revisions = revisions.filter(employee_id__in=employee_ids)
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("type", "Type"),
            _col("effective_from", "Effective", "date"),
            _col("previous_ctc", "Previous CTC", "money"),
            _col("new_ctc", "New CTC", "money"),
            _col("change_pct", "Change %", "number"),
            _col("status", "Status"),
            _col("reason", "Reason"),
        ]
        rows = []
        for rev in revisions.order_by("-effective_from"):
            prev = rev.current_compensation.annual_ctc if rev.current_compensation_id else None
            card = employee_card(rev.employee)
            rows.append(
                {
                    "employee_code": card["employee_code"],
                    "name": card["name"],
                    "type": rev.get_revision_type_display(),
                    "effective_from": rev.effective_from.isoformat(),
                    "previous_ctc": money_str(prev) if prev is not None else "",
                    "new_ctc": money_str(rev.annual_ctc),
                    "change_pct": str(pct(rev.annual_ctc - prev, prev)) if prev else "",
                    "status": rev.get_status_display(),
                    "reason": rev.reason,
                }
            )
        return {**meta, "columns": columns, "rows": rows}

    if key == "lop":
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("working_days", "Working Days", "number"),
            _col("payable_days", "Payable Days", "number"),
            _col("lop_days", "LOP Days", "number"),
            _col("lop_amount", "LOP Impact", "money"),
        ]
        rows = []
        for r in results.filter(lop_days__gt=0):
            impact = ZERO
            for line in r.lines.all():
                for seg in (line.inputs or {}).get("segments", []):
                    try:
                        from decimal import Decimal

                        impact += (
                            Decimal(seg["monthly_reference"])
                            * Decimal(seg["LOP"])
                            / Decimal(seg["WD"])
                        )
                    except Exception:  # noqa: BLE001 - trace shape varies by component
                        pass
            rows.append(
                {
                    "employee_code": r.employee.employee_code,
                    "name": r.employee_snapshot.get("name"),
                    "working_days": str(r.working_days),
                    "payable_days": str(r.payable_days),
                    "lop_days": str(r.lop_days),
                    "lop_amount": money_str(impact),
                }
            )
        return {**meta, "columns": columns, "rows": rows, "totals": _totals(rows, columns)}

    if key == "reimbursements":
        inputs = m.PayrollInput.objects.filter(
            period=period, input_type="reimbursement"
        ).select_related("employee__user", "component")
        if employee_ids is not None:
            inputs = inputs.filter(employee_id__in=employee_ids)
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("component", "Component"),
            _col("amount", "Amount", "money"),
            _col("reason", "Purpose"),
            _col("status", "Status"),
        ]
        rows = [
            {
                "employee_code": i.employee.employee_code,
                "name": employee_card(i.employee)["name"],
                "component": i.component.name,
                "amount": money_str(i.amount or 0),
                "reason": i.reason,
                "status": i.get_status_display(),
            }
            for i in inputs
        ]
        return {**meta, "columns": columns, "rows": rows, "totals": _totals(rows, columns)}

    if key == "variance":
        threshold = period.pay_group.variance_threshold_pct if period else 0
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("previous", "Previous Net", "money"),
            _col("current", "Current Net", "money"),
            _col("change", "Change", "money"),
            _col("change_pct", "Change %", "number"),
            _col("flag", "Above threshold"),
        ]
        rows = [
            {
                "employee_code": r.employee.employee_code,
                "name": r.employee_snapshot.get("name"),
                "previous": money_str(r.previous_net_pay),
                "current": money_str(r.net_pay),
                "change": money_str(r.variance_amount),
                "change_pct": str(r.variance_pct),
                "flag": (
                    "Yes" if r.variance_pct is not None and abs(r.variance_pct) > threshold else ""
                ),
            }
            for r in results.filter(previous_net_pay__isnull=False)
        ]
        return {**meta, "columns": columns, "rows": rows}

    if key == "ytd":
        from .outputs import financial_year_start

        start = financial_year_start(period)
        agg = m.EmployeePayrollResult.objects.filter(
            run__status="finalized",
            run__period__pay_group=period.pay_group,
            run__period__start_date__gte=start,
            run__period__end_date__lte=period.end_date,
        )
        if employee_ids is not None:
            agg = agg.filter(employee_id__in=employee_ids)
        agg = (
            agg.values("employee_id", "employee__employee_code")
            .annotate(
                gross=Sum("gross_earnings"),
                deductions=Sum("total_deductions"),
                net=Sum("net_pay"),
                employer=Sum("employer_contributions"),
                months=Count("id"),
            )
            .order_by("employee__employee_code")
        )
        from employees.models import Employee

        names = {
            e.pk: employee_card(e)["name"]
            for e in Employee.objects.filter(pk__in=[a["employee_id"] for a in agg]).select_related(
                "user"
            )
        }
        columns = [
            _col("employee_code", "Emp ID"),
            _col("name", "Employee"),
            _col("months", "Months", "number"),
            _col("gross", "YTD Gross", "money"),
            _col("deductions", "YTD Deductions", "money"),
            _col("net", "YTD Net", "money"),
            _col("employer", "YTD Employer", "money"),
        ]
        rows = [
            {
                "employee_code": a["employee__employee_code"],
                "name": names.get(a["employee_id"], ""),
                "months": a["months"],
                "gross": money_str(a["gross"]),
                "deductions": money_str(a["deductions"]),
                "net": money_str(a["net"]),
                "employer": money_str(a["employer"]),
            }
            for a in agg
        ]
        return {
            **meta,
            "title": f"{title} ({start:%b %Y} – {period.end_date:%b %Y})",
            "columns": columns,
            "rows": rows,
            "totals": _totals(rows, columns),
        }

    if key == "audit_trail":
        logs = payroll_audit(params)
        columns = [
            _col("at", "When", "datetime"),
            _col("actor", "Who"),
            _col("action", "Action"),
            _col("entity", "Record"),
            _col("details", "Details"),
        ]
        rows = [
            {
                "at": log["created_at"],
                "actor": log["actor"],
                "action": log["action"],
                "entity": f"{log['entity_type']} {log['entity_id']}",
                "details": log["summary"],
            }
            for log in logs
        ]
        return {**meta, "columns": columns, "rows": rows}

    raise KeyError(key)


def _totals(rows, columns):
    totals = {}
    for col in columns:
        if col["type"] == "money":
            from decimal import Decimal

            totals[col["key"]] = money_str(
                sum((Decimal(r.get(col["key"]) or 0) for r in rows), ZERO)
            )
    return totals


def payroll_audit(params):
    logs = (
        AuditLog.objects.filter(action__startswith="payroll.")
        .select_related("actor")
        .order_by("-id")
    )
    if params.get("entity_type"):
        logs = logs.filter(entity_type=params["entity_type"])
    if params.get("entity_id"):
        logs = logs.filter(entity_id=params["entity_id"])
    if params.get("action"):
        logs = logs.filter(action__icontains=params["action"])
    if params.get("search"):
        s = params["search"]
        logs = logs.filter(
            Q(action__icontains=s)
            | Q(entity_type__icontains=s)
            | Q(actor__email__icontains=s)
            | Q(actor__first_name__icontains=s)
        )
    if params.get("from"):
        logs = logs.filter(created_at__date__gte=params["from"])
    if params.get("to"):
        logs = logs.filter(created_at__date__lte=params["to"])
    limit = min(int(params.get("limit") or 200), 1000)
    return [
        {
            "id": log.pk,
            "created_at": log.created_at.isoformat(),
            "actor": (
                (f"{log.actor.first_name} {log.actor.last_name}".strip() or log.actor.email)
                if log.actor
                else "system"
            ),
            "action": log.action.removeprefix("payroll."),
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "diff": log.diff,
            "summary": _summarise(log.diff),
        }
        for log in logs[:limit]
    ]


def _summarise(diff):
    if not diff:
        return ""
    parts = []
    if diff.get("reason"):
        parts.append(f"Reason: {diff['reason']}")
    changes = diff.get("changes")
    if isinstance(changes, dict) and changes and "new" not in changes and "old" not in changes:
        fields = [k for k in changes if isinstance(changes[k], dict)]
        if fields:
            parts.append("Changed: " + ", ".join(fields[:8]))
    for key in ("period", "status", "step", "count", "rows", "kind", "version"):
        if key in diff:
            parts.append(f"{key}: {diff[key]}")
    return "; ".join(parts)


# --------------------------------------------------------------------- dashboard


def dashboard(pay_group, period, employee_ids=None):
    today = datetime.date.today()
    periods = list(pay_group.periods.order_by("year", "month"))
    if period is None:
        period = next(
            (p for p in periods if p.status != "completed"), periods[-1] if periods else None
        )

    strip = []
    anchor = (period.year, period.month) if period else (today.year, today.month)
    by_key = {(p.year, p.month): p for p in periods}
    for offset in range(-2, 3):
        y, mth = anchor
        mth += offset
        while mth < 1:
            mth += 12
            y -= 1
        while mth > 12:
            mth -= 12
            y += 1
        p = by_key.get((y, mth))
        strip.append(
            {
                "year": y,
                "month": mth,
                "id": str(p.pk) if p else None,
                "status": (
                    p.status
                    if p
                    else ("upcoming" if (y, mth) > (today.year, today.month) else "not_created")
                ),
                "is_selected": bool(period and p and p.pk == period.pk),
            }
        )
    if period is None:
        return {
            "pay_group": {"id": str(pay_group.pk), "name": pay_group.name},
            "period": None,
            "periods": strip,
        }

    run = official_run(period)
    prev_period = (
        pay_group.periods.filter(end_date__lt=period.start_date).order_by("-end_date").first()
    )
    prev_run = official_run(prev_period) if prev_period else None

    def kpi(field, run_obj):
        if run_obj is None:
            return None
        return getattr(run_obj, field)

    kpis = []
    for key, label, field in (
        ("employees", "Employees", "employee_count"),
        ("gross", "Gross Payroll", "gross_total"),
        ("net", "Net Pay", "net_total"),
        ("deductions", "Total Deductions", "deduction_total"),
        ("employer_cost", "Payroll Cost", "employer_cost_total"),
    ):
        cur, prev = kpi(field, run), kpi(field, prev_run)
        kpis.append(
            {
                "key": key,
                "label": label,
                "value": str(cur) if cur is not None else None,
                "previous": str(prev) if prev is not None else None,
                "change_pct": str(pct((cur or 0) - (prev or 0), prev)) if prev else None,
            }
        )
    if run:
        employer = run.results.aggregate(total=Sum("employer_contributions"))["total"] or ZERO
        kpis.append(
            {
                "key": "employer_contributions",
                "label": "Employer Contributions",
                "value": str(employer),
                "previous": None,
                "change_pct": None,
            }
        )

    readiness = period_service.readiness(period)
    joiners, exits = period_service.joiners_and_exits(period)
    inputs = period.inputs.exclude(status__in=("rejected", "superseded"))
    step_status = period.step_status or {}
    variable_types = ("bonus", "incentive", "overtime", "shift_allowance", "arrears")
    adjustment_types = (
        "reimbursement",
        "adhoc_deduction",
        "recovery",
        "loan_recovery",
        "one_time_earning",
    )
    counts = {
        "attendance": f"{period.attendance.count()} of {readiness['employee_count']} employees",
        "joiners_exits": f"{len(joiners)} joiners | {len(exits)} exits",
        "revisions_variable": (f"{inputs.filter(input_type__in=variable_types).count()} " "inputs"),
        "reimbursements": (f"{inputs.filter(input_type__in=adjustment_types).count()} " "items"),
        "holds_adjustments": (
            f"{period.employee_actions.filter(kind='hold', decision='hold').count()} "
            f"holds | {period.overrides.filter(is_active=True).count()} overrides"
        ),
        "statutory": f"{readiness['employee_count']} employees",
    }
    pending_inputs = inputs.filter(status="pending").count()
    steps = []
    for key, label in period_service.STEPS[:-1]:
        status = step_status.get(key)
        hint = None
        if key == "attendance" and any(
            c["code"] in ("missing_attendance", "pending_attendance") and c["count"]
            for c in readiness["checks"]
        ):
            hint = "items_to_review"
        if key in ("revisions_variable", "reimbursements") and pending_inputs:
            hint = "pending"
        if key == "joiners_exits" and any(not a for _, _, a in joiners + exits):
            hint = "items_to_review"
        steps.append(
            {
                "key": key,
                "label": label,
                "status": status or hint or "ready",
                "summary": counts.get(key, ""),
            }
        )

    exceptions = run.exceptions.filter(status="open") if run else m.PayrollException.objects.none()
    grouped = (
        exceptions.values("rule_code", "severity")
        .annotate(n=Count("id"))
        .order_by("severity", "-n")
    )
    sample = {e.rule_code: e.message for e in exceptions}
    health = {
        "errors": run.error_count if run else readiness["blocking"],
        "warnings": run.warning_count if run else readiness["warnings"],
        "ready": (
            run.results.filter(validation_status="ready").count()
            if run
            else readiness["ready_count"]
        ),
        "issues": (
            [
                {
                    "rule_code": g["rule_code"],
                    "severity": g["severity"],
                    "count": g["n"],
                    "message": sample.get(g["rule_code"], ""),
                }
                for g in grouped[:6]
            ]
            if run
            else [
                {
                    "rule_code": c["code"],
                    "severity": c["severity"],
                    "count": c["count"],
                    "message": c["label"],
                }
                for c in readiness["checks"]
                if c["count"]
            ]
        ),
    }
    approvals = [
        {
            "stage": a.stage,
            "label": a.get_stage_display(),
            "status": a.status,
            "approver": (a.approver.get_full_name() or a.approver.email) if a.approver else "",
            "acted_at": a.acted_at.isoformat() if a.acted_at else None,
            "comments": a.comments,
        }
        for a in (run.approvals.exclude(status="cancelled").order_by("sequence") if run else [])
    ]
    activity = payroll_audit({"limit": 8})
    return {
        "pay_group": {"id": str(pay_group.pk), "name": pay_group.name, "code": pay_group.code},
        "period": {
            "id": str(period.pk),
            "year": period.year,
            "month": period.month,
            "status": period.status,
            "status_label": period.get_status_display(),
            "start_date": period.start_date.isoformat(),
            "end_date": period.end_date.isoformat(),
            "pay_date": period.pay_date.isoformat(),
            "step_status": step_status,
        },
        "periods": strip,
        "run": (
            None
            if run is None
            else {
                "id": str(run.pk),
                "run_no": run.run_no,
                "status": run.status,
                "calculated_at": run.calculated_at.isoformat() if run.calculated_at else None,
            }
        ),
        "kpis": kpis,
        "steps": steps,
        "health": health,
        "approvals": approvals,
        "activity": activity,
        "readiness": readiness,
    }


def period_label(year, month):
    start, _ = month_bounds(year, month)
    return f"{start:%b %Y}"
