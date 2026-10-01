"""Employee payroll calculation (Calculation Rules §2, the canonical 10-step
sequence). A pure function over plain data: the same context always produces
the same result (PAY-FR-015, PAY-NFR-004), and it can be unit-tested without a
database.

Context shape (all dates are datetime.date, money Decimal or str):
    period      {start, end, year, month, working_days}
    pay_group   {proration_basis, mid_period_revision_policy, net_pay_rounding}
    employee    {id, date_of_joining, date_of_exit}
    profile     {payroll_start_date, payroll_end_date, pf_applicable,
                 esi_applicable, pt_applicable, lwf_applicable, work_state} | None
    compensations [{id, version_no, effective_from, effective_to, annual_ctc,
                    structure_code, structure_version, lines}]
    attendance  {working_days, payable_days, lop_days, status} | None
    inputs      [{id, input_type, amount, units, rate, component: line-config}]
    overrides   {component_code: {id, amount, reason}}
    rules       [statutory rule dicts]
"""

from . import statutory
from .breakup import BreakupError, compute_breakup
from .formula import FormulaError, evaluate
from .money import ZERO, D, q4, round_money

ENGINE_VERSION = "1.0.0"
DEDUCTION_INPUTS = ("adhoc_deduction", "recovery", "loan_recovery", "tds")
TYPE_ORDER = {"earning": 0, "deduction": 1, "employer_contribution": 2}


def _days(a, b):
    return (b - a).days + 1


def payable_window(ctx):
    period = ctx["period"]
    employee = ctx["employee"]
    profile = ctx.get("profile") or {}
    start_candidates = [period["start"]]
    end_candidates = [period["end"]]
    for value in (employee.get("date_of_joining"), profile.get("payroll_start_date")):
        if value:
            start_candidates.append(value)
    for value in (employee.get("date_of_exit"), profile.get("payroll_end_date")):
        if value:
            end_candidates.append(value)
    return max(start_candidates), min(end_candidates)


def resolve_days(ctx, window_start, window_end):
    """Return (WD, PD_window, LOP, basis_note). WD is the configured
    denominator; PD_window the payable days before LOP (Calc Rules §4)."""
    period = ctx["period"]
    basis = ctx["pay_group"].get("proration_basis", "calendar_days")
    attendance = ctx.get("attendance")
    period_days = _days(period["start"], period["end"])
    window_days = _days(window_start, window_end)
    full = window_start == period["start"] and window_end == period["end"]

    if basis == "fixed_30":
        wd = D(30)
        pd = wd if full else max(ZERO, D(30) - D(period_days - window_days))
        note = "Fixed 30-day month"
    elif basis == "working_days":
        wd = D(attendance["working_days"]) if attendance else D(period["working_days"])
        if full:
            pd = wd
        elif attendance:
            pd = D(attendance["payable_days"]) + D(attendance["lop_days"])
        else:
            pd = q4(wd * window_days / period_days)
        note = "Working days"
    else:
        wd = D(period_days)
        pd = wd if full else D(window_days)
        note = "Calendar days"

    lop = D(attendance["lop_days"]) if attendance else ZERO
    lop = min(lop, pd)
    return wd, pd, lop, note


def segments_for(ctx, window_start, window_end):
    comps = [
        c
        for c in ctx.get("compensations", [])
        if c["effective_from"] <= window_end
        and (c.get("effective_to") is None or c["effective_to"] >= window_start)
    ]
    comps.sort(key=lambda c: c["effective_from"])
    if not comps:
        return [], []
    notes = []
    policy = ctx["pay_group"].get("mid_period_revision_policy", "split")
    if policy == "next_period" or len(comps) == 1:
        at_start = [c for c in comps if c["effective_from"] <= window_start] or comps[:1]
        chosen = at_start[-1]
        if len(comps) > 1:
            notes.append(
                {
                    "severity": "info",
                    "rule_code": "REVISION_DEFERRED",
                    "message": (
                        "A salary revision starts mid-period; per "
                        "pay-group policy it applies from the next period."
                    ),
                }
            )
        return [(window_start, window_end, chosen)], notes
    segments = []
    for comp in comps:
        seg_start = max(window_start, comp["effective_from"])
        seg_end = min(window_end, comp["effective_to"] or window_end)
        if seg_start <= seg_end:
            segments.append((seg_start, seg_end, comp))
    return segments, notes


def calculate_employee(ctx: dict) -> dict:
    exceptions = []
    period = ctx["period"]
    profile = ctx.get("profile") or {}
    rules = ctx.get("rules", [])
    rounding_net = ctx["pay_group"].get("net_pay_rounding", "nearest_rupee")
    applicability = {
        "pf": profile.get("pf_applicable", True),
        "esi": profile.get("esi_applicable", False),
        "pt": profile.get("pt_applicable", True),
        "lwf": profile.get("lwf_applicable", False),
        "state": profile.get("work_state", ""),
    }

    window_start, window_end = payable_window(ctx)
    result = {
        "engine_version": ENGINE_VERSION,
        "lines": [],
        "exceptions": exceptions,
        "segments": [],
        "compensation_id": None,
        "is_joiner": False,
        "is_exit": False,
        "has_revision": False,
    }
    if window_start > window_end:
        result.update(_zero_totals())
        exceptions.append(
            {
                "severity": "warning",
                "rule_code": "NOT_IN_PERIOD",
                "message": "Employee is not payroll-eligible on any day of this period.",
            }
        )
        return result

    wd, pd_window, lop, basis_note = resolve_days(ctx, window_start, window_end)
    result["is_joiner"] = window_start > period["start"]
    result["is_exit"] = window_end < period["end"]
    result.update({"working_days": wd, "payable_days": pd_window - lop, "lop_days": lop})

    segments, notes = segments_for(ctx, window_start, window_end)
    exceptions.extend(notes)
    if not segments:
        result.update(_zero_totals())
        exceptions.append(
            {
                "severity": "blocking",
                "rule_code": "NO_COMPENSATION",
                "message": "No approved salary structure / compensation covers this period.",
            }
        )
        return result
    result["has_revision"] = len({s[2]["id"] for s in segments}) > 1 or any(
        window_start < s[2]["effective_from"] <= window_end for s in segments
    )

    window_days = _days(window_start, window_end)
    acc = {}  # component code -> accumulator
    order_hint = {}

    def add(code, meta, amount, part, refs=None, inputs=None):
        entry = acc.setdefault(
            code,
            {"meta": meta, "pre": ZERO, "parts": [], "refs": [], "inputs": [], "formula": set()},
        )
        entry["pre"] += amount
        entry["parts"].append(part)
        entry["refs"].extend(refs or [])
        if inputs:
            entry["inputs"].append(inputs)

    remaining_pd, remaining_lop = pd_window, lop
    last_breakup, last_segment_lines = None, []
    for index, (seg_start, seg_end, comp) in enumerate(segments):
        last = index == len(segments) - 1
        seg_days = _days(seg_start, seg_end)
        seg_pd = remaining_pd if last else q4(pd_window * seg_days / window_days)
        seg_lop = remaining_lop if last else (q4(lop * seg_pd / pd_window) if pd_window else ZERO)
        remaining_pd -= seg_pd
        remaining_lop -= seg_lop
        try:
            breakup = compute_breakup(
                comp["lines"],
                comp["annual_ctc"],
                rules=rules,
                as_of=seg_start,
                applicability=applicability,
                strict=False,
            )
        except (BreakupError, FormulaError) as exc:
            exceptions.append(
                {"severity": "blocking", "rule_code": "STRUCTURE_ERROR", "message": str(exc)}
            )
            result.update(_zero_totals())
            return result
        for message in breakup["errors"]:
            exceptions.append(
                {"severity": "blocking", "rule_code": "STRUCTURE_ERROR", "message": message}
            )
        config = {line["code"]: line for line in comp["lines"]}
        result["segments"].append(
            {
                "from": seg_start.isoformat(),
                "to": seg_end.isoformat(),
                "compensation_id": str(comp["id"]),
                "compensation_version": comp["version_no"],
                "structure": f"{comp['structure_code']} v{comp['structure_version']}",
                "annual_ctc": str(D(comp["annual_ctc"])),
                "payable_days": str(seg_pd),
                "lop_days": str(seg_lop),
            }
        )
        for item in breakup["lines"]:
            code = item["code"]
            line = config[code]
            order_hint[code] = line.get("order", 0)
            if item["component_type"] == "deduction" and line["calculation_type"] == "rule_based":
                continue
            if line["calculation_type"] in ("rule_based", "units_rate", "actual"):
                continue
            monthly = D(item["monthly"])
            if line.get("is_proratable", True):
                amount = monthly * seg_pd / wd if wd else ZERO
                formula = f"{monthly} × {seg_pd} ÷ {wd}"
            else:
                amount = monthly if last else ZERO
                formula = f"{monthly} (not prorated)" if last else ""
            if line.get("is_lop_applicable", True) and seg_lop > 0:
                if line.get("is_proratable", True) or last:
                    amount -= monthly * seg_lop / wd if wd else ZERO
                    formula += f" − {monthly} × {seg_lop} LOP ÷ {wd}"
            amount = max(amount, ZERO)
            add(
                code,
                _meta(line, comp),
                amount,
                formula,
                inputs={
                    "monthly_reference": str(monthly),
                    "segment": f"{seg_start} to {seg_end}",
                    "PD": str(seg_pd),
                    "WD": str(wd),
                    "LOP": str(seg_lop),
                    "annual_ctc": str(D(comp["annual_ctc"])),
                    "structure_basis": item["basis"],
                },
            )
        last_breakup, last_segment_lines = breakup, comp["lines"]
        result["compensation_id"] = comp["id"]
        last_comp = comp

    monthly_refs = {item["code"]: D(item["monthly"]) for item in last_breakup["lines"]}

    # Step 6: approved variable inputs.
    tds_manual = ZERO
    has_tds_manual = False
    for entry in ctx.get("inputs", []):
        comp_cfg = entry["component"]
        code = comp_cfg["code"]
        if entry["input_type"] == "tds":
            has_tds_manual = True
            tds_manual += D(entry.get("amount"))
            continue
        amount, formula = _input_amount(entry, comp_cfg, monthly_refs, wd, pd_window - lop)
        add(
            code,
            _meta(comp_cfg, None),
            amount,
            f"{entry['input_type'].replace('_', ' ')}: {formula}",
            refs=[f"input:{entry['id']}"],
            inputs={
                "input_id": str(entry["id"]),
                "units": str(entry.get("units") or ""),
                "rate": str(entry.get("rate") or ""),
            },
        )
        order_hint.setdefault(code, comp_cfg.get("order", 500))

    lines = {}
    for code, entry in acc.items():
        meta = entry["meta"]
        pre = q4(entry["pre"])
        lines[code] = _line(
            meta,
            pre,
            round_money(pre, meta["rounding"]),
            " + ".join(p for p in entry["parts"] if p),
            entry,
        )

    earned = {c: line["amount"] for c, line in lines.items() if line["component_type"] == "earning"}
    gross = sum(
        (
            line["amount"]
            for line in lines.values()
            if line["component_type"] == "earning" and line["part_of_gross"]
        ),
        ZERO,
    )

    # Steps 7 and 9: statutory deductions and employer contributions on actual earned wages.
    stat_ctx = {
        "pf_wage": sum(
            (
                line["amount"]
                for line in lines.values()
                if line["component_type"] == "earning" and line["include_in_pf_wage"]
            ),
            ZERO,
        ),
        "esi_wage": sum(
            (
                line["amount"]
                for line in lines.values()
                if line["component_type"] == "earning" and line["include_in_esi_wage"]
            ),
            ZERO,
        ),
        "gross": gross,
        "esi_eligibility_gross": last_breakup["totals"]["gross_monthly"],
        "taxable_gross": sum(
            (
                line["amount"]
                for line in lines.values()
                if line["component_type"] == "earning" and line["is_taxable"]
            ),
            ZERO,
        ),
        "month": period["month"],
        "components": earned,
    }
    for line_cfg in last_segment_lines:
        if line_cfg["calculation_type"] != "rule_based":
            continue
        code = line_cfg["code"]
        meta = _meta(line_cfg, last_comp)
        order_hint[code] = line_cfg.get("order", 0)
        rule_code = line_cfg.get("statutory_rule_code", "")
        if rule_code == "TDS" and has_tds_manual:
            pre = q4(tds_manual)
            lines[code] = _line(
                meta,
                pre,
                round_money(pre, meta["rounding"]),
                "Manual TDS input for the period",
                None,
                basis="Manual TDS entered for this period (MVP)",
            )
            continue
        flag = {"PF": "pf", "ES": "esi", "PT": "pt", "LW": "lwf"}.get(rule_code[:2])
        if flag and not applicability.get(flag, True):
            continue
        rule = statutory.select_rule(
            rules, rule_code, period["end"], applicability["state"], ctx.get("legal_entity_id")
        )
        if rule is None:
            exceptions.append(
                {
                    "severity": "warning",
                    "rule_code": "STATUTORY_RULE_MISSING",
                    "message": (
                        f"No active {rule_code} rule for "
                        f"{period['end']}; {code} not calculated."
                    ),
                }
            )
            continue
        amount, basis, formula, inputs = statutory.apply(rule, stat_ctx)
        pre = q4(amount)
        line = _line(meta, pre, round_money(pre, meta["rounding"]), formula, None, basis=basis)
        line["inputs"] = inputs
        line["rule_version"] = statutory.rule_version(rule)
        if not rule.get("is_reviewed"):
            line["dependencies"].append("statutory rule pending compliance review")
        lines[code] = line

    if has_tds_manual and not any(
        c.get("statutory_rule_code") == "TDS" for c in last_segment_lines
    ):
        for entry in ctx.get("inputs", []):
            if entry["input_type"] == "tds":
                cfg = entry["component"]
                meta = _meta(cfg, None)
                pre = q4(tds_manual)
                lines[cfg["code"]] = _line(
                    meta,
                    pre,
                    round_money(pre, meta["rounding"]),
                    "Manual TDS input",
                    None,
                    basis="Manual TDS entered for this period",
                )
                order_hint.setdefault(cfg["code"], 800)
                break

    # Overrides (Calc Rules §10): keep the calculated value, apply the override.
    for code, override in (ctx.get("overrides") or {}).items():
        if code in lines:
            line = lines[code]
            line["calculated_amount"] = line["amount"]
            line["amount"] = round_money(override["amount"], "paise")
            line["is_overridden"] = True
            line["override_ref"] = str(override["id"])
            line["calculation_basis"] += f" | Overridden: {override['reason']}"
            exceptions.append(
                {
                    "severity": "warning",
                    "rule_code": "MANUAL_OVERRIDE",
                    "message": (
                        f"{code} overridden from {line['calculated_amount']} "
                        f"to {line['amount']}: {override['reason']}"
                    ),
                }
            )

    ordered = sorted(
        lines.values(),
        key=lambda ln: (
            TYPE_ORDER.get(ln["component_type"], 9),
            order_hint.get(ln["component_code"], 0),
            ln["component_code"],
        ),
    )
    for sequence, line in enumerate(ordered, start=1):
        line["sequence"] = sequence

    gross = sum(
        (
            ln["amount"]
            for ln in ordered
            if ln["component_type"] == "earning" and ln["part_of_gross"]
        ),
        ZERO,
    )
    paid = sum(
        (ln["amount"] for ln in ordered if ln["component_type"] == "earning" and ln["part_of_net"]),
        ZERO,
    )
    deductions = sum((ln["amount"] for ln in ordered if ln["component_type"] == "deduction"), ZERO)
    employer = sum(
        (ln["amount"] for ln in ordered if ln["component_type"] == "employer_contribution"), ZERO
    )
    net = round_money(paid - deductions, rounding_net)

    # Step 10: employee-level validations.
    if net < 0:
        exceptions.append(
            {
                "severity": "blocking",
                "rule_code": "NEGATIVE_NET_PAY",
                "message": (
                    f"Net pay is negative ({net}). Reduce recoveries "
                    "or configure a carry-forward policy."
                ),
            }
        )
    elif net == 0:
        exceptions.append(
            {"severity": "info", "rule_code": "ZERO_NET_PAY", "message": "Net pay is zero."}
        )
    if pd_window - lop <= 0:
        exceptions.append(
            {
                "severity": "warning",
                "rule_code": "ZERO_PAYABLE_DAYS",
                "message": "Zero payable days in this period (full LOP or no eligible days).",
            }
        )
    if result["is_joiner"]:
        exceptions.append(
            {
                "severity": "info",
                "rule_code": "NEW_JOINER",
                "message": f"Joined {window_start}; eligible components prorated ({basis_note}).",
            }
        )
    if result["is_exit"]:
        exceptions.append(
            {
                "severity": "info",
                "rule_code": "EXIT",
                "message": (
                    f"Exits {window_end}; eligible components "
                    "prorated. Advanced F&F is handled separately."
                ),
            }
        )
    if result["has_revision"]:
        exceptions.append(
            {
                "severity": "info",
                "rule_code": "REVISION_IN_PERIOD",
                "message": "A salary revision takes effect in this period.",
            }
        )

    result.update(
        {
            "lines": ordered,
            "gross_earnings": gross,
            "total_deductions": deductions,
            "net_pay": net,
            "employer_contributions": employer,
            "employer_cost": paid + employer,
            "window": {"from": window_start.isoformat(), "to": window_end.isoformat()},
            "proration_basis": basis_note,
        }
    )
    return result


def _input_amount(entry, cfg, monthly_refs, wd, pd):
    if entry.get("amount") not in (None, ""):
        return D(entry["amount"]), f"approved amount {D(entry['amount'])}"
    units = D(entry.get("units"))
    rate = D(entry.get("rate")) if entry.get("rate") not in (None, "") else D(cfg.get("value"))
    if cfg.get("calculation_type") == "formula" and cfg.get("formula_expr"):
        env = dict(monthly_refs)
        env.update(
            {
                "U": units,
                "RATE": rate,
                "WD": wd,
                "PD": pd,
                "LOP": 0,
                "CTC": 0,
                "CTC_M": 0,
                "GROSS": 0,
            }
        )
        return evaluate(cfg["formula_expr"], env), f"{cfg['formula_expr']} with U={units}"
    return units * rate, f"{units} units × {rate}"


def _meta(line, comp):
    return {
        "component_id": line.get("component_id"),
        "code": line["code"],
        "name": line.get("payslip_label") or line["name"],
        "component_type": line["component_type"],
        "rounding": line.get("rounding", "nearest_rupee"),
        "is_taxable": line.get("is_taxable", True),
        "include_in_pf_wage": line.get("include_in_pf_wage", False),
        "include_in_esi_wage": line.get("include_in_esi_wage", False),
        "part_of_gross": line.get("part_of_gross", True),
        "part_of_net": line.get("part_of_net", True),
        "show_on_payslip": line.get("show_on_payslip", True),
        "calculation_type": line.get("calculation_type"),
        "component_version": line.get("component_version"),
        "compensation_version": comp["version_no"] if comp else None,
        "structure": f"{comp['structure_code']} v{comp['structure_version']}" if comp else "",
    }


def _line(meta, pre, amount, formula, entry, basis=None):
    source = (
        [f"compensation v{meta['compensation_version']} / {meta['structure']}"]
        if meta.get("structure")
        else []
    )
    return {
        "component_id": meta["component_id"],
        "component_code": meta["code"],
        "component_name": meta["name"],
        "component_type": meta["component_type"],
        "amount": amount,
        "pre_round_amount": pre,
        "calculated_amount": amount,
        "is_overridden": False,
        "override_ref": "",
        "is_taxable": meta["is_taxable"],
        "include_in_pf_wage": meta["include_in_pf_wage"],
        "include_in_esi_wage": meta["include_in_esi_wage"],
        "part_of_gross": meta["part_of_gross"],
        "part_of_net": meta["part_of_net"],
        "show_on_payslip": meta["show_on_payslip"],
        "calculation_basis": basis
        or f"{meta['calculation_type']} ({meta['structure'] or 'period input'})",
        "formula": formula,
        "inputs": {"segments": entry["inputs"]} if entry and entry.get("inputs") else {},
        "rule_version": f"{meta['code']} config v{meta.get('component_version') or 1}",
        "source_refs": source + (entry["refs"] if entry else []),
        "dependencies": [],
        "rate_display": "",
        "units_display": "",
    }


def _zero_totals():
    return {
        "gross_earnings": ZERO,
        "total_deductions": ZERO,
        "net_pay": ZERO,
        "employer_contributions": ZERO,
        "employer_cost": ZERO,
        "working_days": ZERO,
        "payable_days": ZERO,
        "lop_days": ZERO,
    }
