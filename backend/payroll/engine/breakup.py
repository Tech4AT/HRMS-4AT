"""Structure breakup: turn a salary structure + annual CTC into monthly and
annual component amounts (PAY-002 preview, PAY-004 assignment breakup, and
the monthly reference amounts M the payroll calculation prorates).

Each `line` is plain data (a resolved component configuration), so the same
function serves the live builder preview and the frozen version snapshots
used by payroll runs.
"""

from . import statutory
from .formula import FormulaError, evaluate, references
from .money import HUNDRED, ZERO, D, pct, q4, round_money

INPUT_DRIVEN = ("units_rate", "actual")
STATUTORY_FLAG = {
    "PF_EMPLOYEE": "pf",
    "PF_EMPLOYER": "pf",
    "ESI_EMPLOYEE": "esi",
    "ESI_EMPLOYER": "esi",
    "PT": "pt",
    "LWF_EMPLOYEE": "lwf",
    "LWF_EMPLOYER": "lwf",
}


class BreakupError(ValueError):
    def __init__(self, message, code="PAY_INVALID_STRUCTURE", details=None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def dependencies(line: dict, lines: list) -> set:
    calc = line["calculation_type"]
    if calc == "percent_of_component":
        return {line.get("base_component_code") or "BASIC"}
    if calc == "formula":
        codes = {item["code"] for item in lines}
        return {ref for ref in references(line.get("formula_expr") or "") if ref in codes}
    if calc == "rule_based":
        return {
            item["code"]
            for item in lines
            if item["component_type"] == "earning"
            and item["calculation_type"] not in ("rule_based", "balancing")
        }
    return set()


def evaluation_order(lines: list) -> list:
    """Topological order of every non-balancing line; raises on a cycle."""
    by_code = {line["code"]: line for line in lines}
    balancing = {line["code"] for line in lines if line["calculation_type"] == "balancing"}
    graph = {}
    for line in lines:
        if line["code"] in balancing:
            continue
        deps = dependencies(line, lines) - balancing
        missing = sorted(d for d in deps if d not in by_code)
        if missing:
            raise BreakupError(
                f"{line['code']} refers to {', '.join(missing)}, which is not in this structure.",
                details={"component": line["code"], "missing": missing},
            )
        graph[line["code"]] = deps

    order, state = [], {}

    def visit(code, path):
        if state.get(code) == "done":
            return
        if state.get(code) == "visiting":
            cycle = path[path.index(code) :] + [code]
            raise BreakupError(
                f"Circular reference: {' → '.join(cycle)}.",
                code="PAY_CIRCULAR_REFERENCE",
                details={"cycle": cycle},
            )
        state[code] = "visiting"
        for dep in sorted(graph[code]):
            visit(dep, path + [code])
        state[code] = "done"
        order.append(code)

    for code in sorted(graph, key=lambda c: (by_code[c].get("order", 0), c)):
        visit(code, [])
    return order


def _applies(line, applicability):
    flag = STATUTORY_FLAG.get(line.get("statutory_rule_code", ""))
    if flag is None:
        return True
    return bool(applicability.get(flag, True))


def compute_breakup(
    lines: list,
    annual_ctc,
    *,
    rules: list = (),
    as_of=None,
    applicability: dict | None = None,
    tolerance=1,
    strict: bool = True,
) -> dict:
    """Return {"lines": [...], "totals": {...}, "errors": [...], "warnings": [...]}.

    With strict=True a structural problem (cycle, missing reference, two
    balancing components, negative balancing amount, CTC not reconciling)
    raises BreakupError; otherwise it is reported in `errors`."""
    applicability = applicability or {}
    annual_ctc = D(annual_ctc)
    ctc_m = annual_ctc / 12
    errors, warnings = [], []

    balancing_lines = [line for line in lines if line["calculation_type"] == "balancing"]
    if len(balancing_lines) > 1:
        raise BreakupError(
            "A structure can have only one balancing component "
            f"({', '.join(line['code'] for line in balancing_lines)})."
        )
    balancing = balancing_lines[0] if balancing_lines else None
    order = evaluation_order(lines)
    by_code = {line["code"]: line for line in lines}

    def run(b_value):
        values, notes = {}, {}
        if balancing:
            values[balancing["code"]] = b_value
        for code in order:
            line = by_code[code]
            calc = line["calculation_type"]
            value = D(line.get("value"))
            if calc == "fixed":
                amount, note = value, (f"Fixed {value} per month", "FIXED")
            elif calc == "percent_of_ctc":
                amount = annual_ctc * value / HUNDRED / 12
                note = (f"{value}% of annual CTC, monthlyized", "CTC × R% ÷ 12")
            elif calc == "percent_of_component":
                base = line.get("base_component_code") or "BASIC"
                amount = D(values.get(base)) * value / HUNDRED
                note = (f"{value}% of {base}", f"{base} × R%")
            elif calc == "formula":
                env = {
                    "CTC": annual_ctc,
                    "CTC_M": ctc_m,
                    "GROSS": ZERO,
                    "PD": 1,
                    "WD": 1,
                    "LOP": 0,
                    "U": 0,
                    "RATE": value,
                }
                env.update({c: D(values.get(c)) for c in by_code})
                amount = evaluate(line.get("formula_expr") or "", env)
                note = ("Formula", line.get("formula_expr") or "")
            elif calc in INPUT_DRIVEN:
                amount, note = ZERO, ("Paid from approved period inputs", "INPUT")
            elif calc == "rule_based":
                amount, note = _statutory(line, values, by_code, rules, as_of, applicability)
            else:
                amount, note = ZERO, ("", "")
            values[code] = amount
            notes[code] = note
        return values, notes

    b_value = ZERO
    values, notes = run(b_value)
    if balancing:
        # Solve the balancing component by fixed-point iteration: statutory
        # employer contributions inside CTC may themselves depend on it.
        for _ in range(100):
            others = sum(
                (
                    values[c]
                    for c, line in by_code.items()
                    if line["code"] != balancing["code"]
                    and line.get("part_of_ctc")
                    and line["component_type"] in ("earning", "employer_contribution")
                ),
                ZERO,
            )
            new_b = ctc_m - others
            if abs(new_b - b_value) < D("0.00001"):
                b_value = new_b
                break
            b_value = new_b
            values, notes = run(b_value)
        values[balancing["code"]] = b_value
        notes[balancing["code"]] = (
            "Balancing: monthly CTC minus all other CTC components",
            "CTC ÷ 12 − Σ(other CTC components)",
        )

    result_lines = []
    for line in sorted(lines, key=lambda item: (item.get("order", 0), item["code"])):
        code = line["code"]
        monthly_pre = q4(values.get(code, ZERO))
        monthly = round_money(monthly_pre, line.get("rounding", "nearest_rupee"))
        result_lines.append(
            {
                "code": code,
                "name": line["name"],
                "component_id": line.get("component_id"),
                "component_version": line.get("component_version"),
                "component_type": line["component_type"],
                "category": line.get("category", ""),
                "calculation_type": line["calculation_type"],
                "monthly_pre_round": str(monthly_pre),
                "monthly": monthly,
                "annual": round_money(monthly_pre * 12, line.get("rounding", "nearest_rupee")),
                "basis": notes.get(code, ("", ""))[0],
                "formula": notes.get(code, ("", ""))[1],
                "is_taxable": line.get("is_taxable", True),
                "include_in_pf_wage": line.get("include_in_pf_wage", False),
                "include_in_esi_wage": line.get("include_in_esi_wage", False),
                "part_of_ctc": line.get("part_of_ctc", True),
                "part_of_gross": line.get("part_of_gross", True),
                "part_of_net": line.get("part_of_net", True),
                "input_driven": line["calculation_type"] in INPUT_DRIVEN,
            }
        )

    # Balancing absorbs rounding so the rounded monthly CTC reconciles exactly.
    if balancing:
        target_m = round_money(ctc_m)
        target_a = round_money(annual_ctc)
        bal = next(item for item in result_lines if item["code"] == balancing["code"])
        others_m = sum(
            (
                i["monthly"]
                for i in result_lines
                if i is not bal
                and i["part_of_ctc"]
                and i["component_type"] in ("earning", "employer_contribution")
            ),
            ZERO,
        )
        others_a = sum(
            (
                i["annual"]
                for i in result_lines
                if i is not bal
                and i["part_of_ctc"]
                and i["component_type"] in ("earning", "employer_contribution")
            ),
            ZERO,
        )
        bal["monthly"] = target_m - others_m
        bal["annual"] = target_a - others_a
        if bal["monthly"] < 0:
            message = (
                f"The components exceed the CTC: {balancing['code']} would be "
                f"{bal['monthly']} per month. Lower the other components or raise the CTC."
            )
            if strict:
                raise BreakupError(message, code="PAY_CTC_EXCEEDED")
            errors.append(message)

    totals = _totals(result_lines, annual_ctc)
    diff = totals["ctc_annual_computed"] - round_money(annual_ctc)
    totals["ctc_difference"] = diff
    if not balancing and abs(diff) > D(tolerance) and annual_ctc > 0:
        message = (
            f"CTC does not reconcile: the components add up to {totals['ctc_annual_computed']} "
            f"a year against a CTC of {round_money(annual_ctc)} (difference {diff}). "
            "Add a balancing component or adjust the percentages."
        )
        if strict:
            raise BreakupError(message, code="PAY_CTC_MISMATCH", details={"difference": str(diff)})
        errors.append(message)

    for item in result_lines:
        item["pct_of_ctc"] = pct(item["annual"], annual_ctc)
    return {"lines": result_lines, "totals": totals, "errors": errors, "warnings": warnings}


def _statutory(line, values, by_code, rules, as_of, applicability):
    if not _applies(line, applicability):
        return ZERO, ("Not applicable for this employee", "")
    rule = (
        statutory.select_rule(
            list(rules), line.get("statutory_rule_code", ""), as_of, applicability.get("state", "")
        )
        if as_of
        else None
    )
    if rule is None:
        return ZERO, (f"No active statutory rule {line.get('statutory_rule_code')}", "")
    earnings = [c for c, item in by_code.items() if item["component_type"] == "earning"]
    ctx = {
        "pf_wage": sum(
            (D(values.get(c)) for c in earnings if by_code[c].get("include_in_pf_wage")), ZERO
        ),
        "esi_wage": sum(
            (D(values.get(c)) for c in earnings if by_code[c].get("include_in_esi_wage")), ZERO
        ),
        "gross": sum(
            (D(values.get(c)) for c in earnings if by_code[c].get("part_of_gross", True)), ZERO
        ),
        "taxable_gross": sum(
            (D(values.get(c)) for c in earnings if by_code[c].get("is_taxable", True)), ZERO
        ),
        "month": as_of.month,
        "components": values,
    }
    amount, basis, formula, _ = statutory.apply(rule, ctx)
    return amount, (f"{basis} [{statutory.rule_version(rule)}]", formula)


def _totals(lines, annual_ctc):
    def total(kind, field, predicate=lambda i: True):
        return sum((i[field] for i in lines if i["component_type"] == kind and predicate(i)), ZERO)

    gross_m = total("earning", "monthly", lambda i: i["part_of_gross"])
    gross_a = total("earning", "annual", lambda i: i["part_of_gross"])
    paid_m = total("earning", "monthly", lambda i: i["part_of_net"])
    ded_m = total("deduction", "monthly")
    ded_a = total("deduction", "annual")
    er_m = total("employer_contribution", "monthly", lambda i: i["part_of_ctc"])
    er_a = total("employer_contribution", "annual", lambda i: i["part_of_ctc"])
    ctc_m = total("earning", "monthly", lambda i: i["part_of_ctc"]) + er_m
    ctc_a = total("earning", "annual", lambda i: i["part_of_ctc"]) + er_a
    return {
        "annual_ctc": round_money(annual_ctc),
        "monthly_ctc": round_money(D(annual_ctc) / 12),
        "gross_monthly": gross_m,
        "gross_annual": gross_a,
        "deductions_monthly": ded_m,
        "deductions_annual": ded_a,
        "employer_monthly": er_m,
        "employer_annual": er_a,
        "net_take_home_monthly": paid_m - ded_m,
        "net_take_home_annual": total("earning", "annual", lambda i: i["part_of_net"]) - ded_a,
        "ctc_monthly_computed": ctc_m,
        "ctc_annual_computed": ctc_a,
        "gross_pct_of_ctc": pct(gross_a, annual_ctc),
        "deductions_pct_of_ctc": pct(ded_a, annual_ctc),
        "employer_pct_of_ctc": pct(er_a, annual_ctc),
    }


def validate_structure_lines(lines: list, active_codes: set | None = None) -> list:
    """Configuration checks independent of a CTC (PAY-FR-005). Returns a list
    of error strings; empty means valid."""
    problems = []
    codes = [line["code"] for line in lines]
    if not lines:
        problems.append("Add at least one component.")
    if len(set(codes)) != len(codes):
        problems.append("A component appears more than once.")
    if sum(1 for line in lines if line["calculation_type"] == "balancing") > 1:
        problems.append("Only one balancing component is allowed.")
    for line in lines:
        calc = line["calculation_type"]
        if active_codes is not None and line["code"] not in active_codes:
            problems.append(f"{line['code']} is not an active component.")
        if calc in ("fixed", "percent_of_ctc", "percent_of_component") and line.get("value") in (
            None,
            "",
        ):
            problems.append(f"{line['code']}: a value is required for '{calc}'.")
        if calc == "formula":
            try:
                refs = references(line.get("formula_expr") or "")
            except FormulaError as exc:
                problems.append(f"{line['code']}: {exc}")
                continue
            from .formula import CONTEXT_VARIABLES

            unknown = sorted(r for r in refs if r not in codes and r not in CONTEXT_VARIABLES)
            if unknown:
                problems.append(f"{line['code']}: unknown reference(s) {', '.join(unknown)}.")
        if calc == "rule_based" and not line.get("statutory_rule_code"):
            problems.append(f"{line['code']}: choose the statutory rule it uses.")
    if not problems:
        try:
            evaluation_order(lines)
        except (BreakupError, FormulaError) as exc:
            problems.append(str(exc))
    return problems
