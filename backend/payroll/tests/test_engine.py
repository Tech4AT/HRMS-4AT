"""Calculation engine unit tests: the worked scenarios in the Calculation
Rules spec §14 (CALC-001..009), with expected values written by hand."""

from datetime import date
from decimal import Decimal

import pytest

from payroll.engine.breakup import BreakupError, compute_breakup, validate_structure_lines
from payroll.engine.calculator import calculate_employee
from payroll.engine.formula import FormulaError, evaluate


def line(code, kind, calc, value=None, order=0, **extra):
    data = {
        "code": code,
        "name": code,
        "component_type": kind,
        "calculation_type": calc,
        "value": value,
        "order": order,
        "part_of_ctc": kind != "deduction",
        "part_of_gross": kind == "earning",
        "part_of_net": kind != "employer_contribution",
        "is_proratable": True,
        "is_lop_applicable": True,
        "rounding": "nearest_rupee",
    }
    data.update(extra)
    return data


LINES = [
    line("BASIC", "earning", "percent_of_ctc", "45", 1, include_in_pf_wage=True),
    line("HRA", "earning", "percent_of_component", "50", 2, base_component_code="BASIC"),
    line("SPECIAL", "earning", "balancing", order=3),
    line("PERF", "earning", "percent_of_ctc", "10", 4),
    line(
        "OT",
        "earning",
        "units_rate",
        "500",
        5,
        part_of_ctc=False,
        is_proratable=False,
        is_lop_applicable=False,
    ),
    line(
        "BONUS",
        "earning",
        "actual",
        order=6,
        part_of_ctc=False,
        is_proratable=False,
        is_lop_applicable=False,
    ),
    line("PF_EE", "deduction", "rule_based", order=10, statutory_rule_code="PF_EMPLOYEE"),
    line("PT", "deduction", "rule_based", order=11, statutory_rule_code="PT"),
    line("RECOVERY", "deduction", "actual", order=12),
    line(
        "PF_ER", "employer_contribution", "rule_based", order=20, statutory_rule_code="PF_EMPLOYER"
    ),
]
RULES = [
    {
        "code": "PF_EMPLOYEE",
        "effective_from": "2026-04-01",
        "status": "active",
        "params": {"rate_pct": 12, "wage_ceiling": 15000, "apply_ceiling": False},
    },
    {
        "code": "PF_EMPLOYER",
        "effective_from": "2026-04-01",
        "status": "active",
        "params": {"rate_pct": 12, "wage_ceiling": 15000, "apply_ceiling": False},
    },
    {
        "code": "PT",
        "effective_from": "2026-04-01",
        "status": "active",
        "params": {
            "slabs": [
                {"from": 0, "to": 15000, "amount": 0},
                {"from": 15000.01, "to": None, "amount": 200},
            ]
        },
    },
]


def ctx(**overrides):
    base = {
        "period": {
            "start": date(2026, 9, 1),
            "end": date(2026, 9, 30),
            "year": 2026,
            "month": 9,
            "working_days": 22,
        },
        "pay_group": {"proration_basis": "calendar_days", "mid_period_revision_policy": "split"},
        "employee": {"id": 1, "date_of_joining": date(2024, 4, 1), "date_of_exit": None},
        "profile": {"pf_applicable": True, "pt_applicable": True, "work_state": ""},
        "compensations": [comp("c1", 1, date(2026, 4, 1), None, 1200000)],
        "attendance": {"working_days": 30, "payable_days": 30, "lop_days": 0, "status": "final"},
        "inputs": [],
        "overrides": {},
        "rules": RULES,
    }
    base.update(overrides)
    return base


def comp(cid, version, start, end, ctc):
    return {
        "id": cid,
        "version_no": version,
        "effective_from": start,
        "effective_to": end,
        "annual_ctc": ctc,
        "structure_code": "GS",
        "structure_version": 1,
        "lines": LINES,
    }


def amounts(result):
    return {ln["component_code"]: ln["amount"] for ln in result["lines"]}


def test_structure_breakup_reconciles_to_ctc():
    b = compute_breakup(LINES, 1200000, rules=RULES, as_of=date(2026, 9, 1))
    monthly = {ln["code"]: ln["monthly"] for ln in b["lines"]}
    assert monthly["BASIC"] == Decimal("45000.00")
    assert monthly["HRA"] == Decimal("22500.00")
    assert monthly["PERF"] == Decimal("10000.00")
    assert monthly["PF_ER"] == Decimal("5400.00")
    # balancing absorbs the rest: 100000 - 45000 - 22500 - 10000 - 5400
    assert monthly["SPECIAL"] == Decimal("17100.00")
    assert b["totals"]["ctc_annual_computed"] == Decimal("1200000.00")


def test_structure_without_balancing_must_reconcile():
    lines = [
        line("BASIC", "earning", "percent_of_ctc", "40", 1),
        line("HRA", "earning", "percent_of_ctc", "20", 2),
    ]
    with pytest.raises(BreakupError):
        compute_breakup(lines, 1200000, as_of=date(2026, 9, 1))


def test_circular_formula_is_rejected():
    lines = [
        line("A", "earning", "formula", order=1, formula_expr="B * 2"),
        line("B", "earning", "formula", order=2, formula_expr="A / 2"),
    ]
    assert any("Circular" in p for p in validate_structure_lines(lines))


def test_formula_language_is_safe():
    assert evaluate("min(BASIC, 15000) * 12 / 100", {"BASIC": 45000}) == Decimal("1800")
    for bad in ("__import__('os')", "BASIC.real", "[1,2]", "open('x')"):
        with pytest.raises(FormulaError):
            evaluate(bad, {"BASIC": 1})


def test_calc_001_regular_full_month():
    result = calculate_employee(ctx())
    a = amounts(result)
    assert a["BASIC"] == Decimal("45000.00")
    assert a["PF_EE"] == Decimal("5400.00")
    assert a["PT"] == Decimal("200.00")
    assert result["gross_earnings"] == Decimal("94600.00")
    assert result["net_pay"] == Decimal("89000.00")
    assert result["employer_cost"] == Decimal("100000.00")


def test_calc_002_mid_month_joiner_prorates_eligible_components():
    result = calculate_employee(
        ctx(
            employee={"id": 1, "date_of_joining": date(2026, 9, 12)},
            compensations=[comp("c1", 1, date(2026, 9, 12), None, 1200000)],
            attendance={"working_days": 30, "payable_days": 19, "lop_days": 0, "status": "final"},
        )
    )
    assert amounts(result)["BASIC"] == Decimal("28500.00")  # 45,000 × 19 ÷ 30 (spec §4.1)
    assert result["payable_days"] == Decimal("19")
    assert result["is_joiner"] and not result["has_revision"]


def test_calc_003_exit_prorates_to_lwd():
    result = calculate_employee(
        ctx(
            employee={
                "id": 1,
                "date_of_joining": date(2024, 4, 1),
                "date_of_exit": date(2026, 9, 18),
            }
        )
    )
    assert amounts(result)["BASIC"] == Decimal("27000.00")  # 45,000 × 18 ÷ 30
    assert result["is_exit"]


def test_calc_004_one_lop_day_reduces_only_lop_components():
    result = calculate_employee(
        ctx(
            attendance={"working_days": 30, "payable_days": 29, "lop_days": 1, "status": "final"},
            inputs=[{"id": "i1", "input_type": "bonus", "amount": "5000", "component": LINES[5]}],
        )
    )
    a = amounts(result)
    assert a["BASIC"] == Decimal("43500.00")  # spec §5.1
    assert a["BONUS"] == Decimal("5000.00")  # not LOP-applicable


def test_calc_005_bonus_and_ot_inputs():
    result = calculate_employee(
        ctx(
            inputs=[
                {"id": "i1", "input_type": "bonus", "amount": "10000", "component": LINES[5]},
                {"id": "i2", "input_type": "overtime", "units": "4", "component": LINES[4]},
            ]
        )
    )
    a = amounts(result)
    assert a["BONUS"] == Decimal("10000.00")
    assert a["OT"] == Decimal("2000.00")  # 4 h × 500
    assert result["gross_earnings"] == Decimal("106600.00")


def test_calc_007_mid_period_revision_splits_period():
    result = calculate_employee(
        ctx(
            compensations=[
                comp("c1", 1, date(2026, 4, 1), date(2026, 9, 15), 1200000),
                comp("c2", 2, date(2026, 9, 16), None, 1440000),
            ]
        )
    )
    # Basic 45,000 × 15/30 + 54,000 × 15/30
    assert amounts(result)["BASIC"] == Decimal("49500.00")
    assert result["has_revision"] and len(result["segments"]) == 2


def test_calc_007_next_period_policy_defers_revision():
    result = calculate_employee(
        ctx(
            pay_group={
                "proration_basis": "calendar_days",
                "mid_period_revision_policy": "next_period",
            },
            compensations=[
                comp("c1", 1, date(2026, 4, 1), date(2026, 9, 15), 1200000),
                comp("c2", 2, date(2026, 9, 16), None, 1440000),
            ],
        )
    )
    assert amounts(result)["BASIC"] == Decimal("45000.00")
    assert any(e["rule_code"] == "REVISION_DEFERRED" for e in result["exceptions"])


def test_calc_008_full_month_unpaid_leave():
    result = calculate_employee(
        ctx(attendance={"working_days": 30, "payable_days": 0, "lop_days": 30, "status": "final"})
    )
    assert amounts(result)["BASIC"] == Decimal("0.00")
    assert any(e["rule_code"] == "ZERO_PAYABLE_DAYS" for e in result["exceptions"])


def test_calc_009_negative_net_is_blocking():
    recovery = {"id": "r1", "input_type": "recovery", "amount": "200000", "component": LINES[8]}
    result = calculate_employee(ctx(inputs=[recovery]))
    assert result["net_pay"] < 0
    assert any(
        e["rule_code"] == "NEGATIVE_NET_PAY" and e["severity"] == "blocking"
        for e in result["exceptions"]
    )


def test_no_compensation_is_blocking():
    result = calculate_employee(ctx(compensations=[]))
    assert any(
        e["rule_code"] == "NO_COMPENSATION" and e["severity"] == "blocking"
        for e in result["exceptions"]
    )


def test_override_keeps_calculated_value():
    result = calculate_employee(
        ctx(overrides={"PERF": {"id": "o1", "amount": "0", "reason": "Held by HR"}})
    )
    perf = next(ln for ln in result["lines"] if ln["component_code"] == "PERF")
    assert perf["amount"] == Decimal("0.00") and perf["calculated_amount"] == Decimal("10000.00")
    assert perf["is_overridden"]


def test_deterministic():
    assert calculate_employee(ctx())["lines"] == calculate_employee(ctx())["lines"]
