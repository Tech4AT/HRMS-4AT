"""Statutory hooks (Calculation Rules §7). The engine owns only the generic
shape of each rule; every rate, ceiling, threshold and slab comes from an
effective-dated StatutoryRule row passed in as plain data.

Rule params (all optional unless noted):
  PF_EMPLOYEE / PF_EMPLOYER : rate_pct*, wage_ceiling, apply_ceiling (bool)
  ESI_EMPLOYEE / ESI_EMPLOYER: rate_pct*, eligibility_gross_limit, rounding
  PT                         : slabs* [{from, to, amount}], month_overrides {"2": 300}
  LWF_EMPLOYEE / LWF_EMPLOYER: amount*, months [6, 12]
  TDS                        : method "manual" | "flat_rate", rate_pct
  GRATUITY                   : rate_pct*, base_component (default BASIC)
"""

from datetime import date

from .money import HUNDRED, ZERO, D, round_money


def select_rule(rules: list, code: str, as_of: date, state: str = "", legal_entity_id=None):
    """The effective rule for `code` on `as_of`. A state-specific rule wins
    over an all-states rule; a legal-entity rule wins over a global one."""
    as_of_s = as_of.isoformat()
    candidates = []
    for rule in rules:
        if rule["code"] != code or rule.get("status", "active") != "active":
            continue
        if rule["effective_from"] > as_of_s:
            continue
        if rule.get("effective_to") and rule["effective_to"] < as_of_s:
            continue
        if rule.get("state") and rule["state"].lower() != (state or "").lower():
            continue
        if rule.get("legal_entity_id") and str(rule["legal_entity_id"]) != str(legal_entity_id):
            continue
        specificity = (1 if rule.get("state") else 0, 1 if rule.get("legal_entity_id") else 0)
        candidates.append((specificity, rule["effective_from"], rule))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0], c[1]))
    return candidates[-1][2]


def rule_version(rule) -> str:
    if rule is None:
        return ""
    reviewed = "" if rule.get("is_reviewed") else " (not compliance-reviewed)"
    return f"{rule['code']} v{rule.get('version', 1)} effective {rule['effective_from']}{reviewed}"


def apply(rule: dict, ctx: dict) -> tuple:
    """Return (amount, basis, formula, inputs). `ctx` carries the wage bases:
    pf_wage, esi_wage, gross, esi_eligibility_gross, month, components."""
    code = rule["code"]
    params = rule.get("params") or {}

    if code in ("PF_EMPLOYEE", "PF_EMPLOYER"):
        wage = D(ctx.get("pf_wage"))
        ceiling = params.get("wage_ceiling")
        capped = wage
        if params.get("apply_ceiling", True) and ceiling not in (None, ""):
            capped = min(wage, D(ceiling))
        rate = D(params.get("rate_pct"))
        return (
            capped * rate / HUNDRED,
            f"{rate}% of PF wage" + (f" capped at {ceiling}" if capped != wage else ""),
            "min(PF_WAGE, CEILING) × RATE%",
            {
                "pf_wage": str(wage),
                "wage_used": str(capped),
                "rate_pct": str(rate),
                "ceiling": ceiling,
            },
        )

    if code in ("ESI_EMPLOYEE", "ESI_EMPLOYER"):
        limit = params.get("eligibility_gross_limit")
        eligibility_gross = D(ctx.get("esi_eligibility_gross", ctx.get("gross")))
        rate = D(params.get("rate_pct"))
        inputs = {"esi_wage": str(D(ctx.get("esi_wage"))), "rate_pct": str(rate), "limit": limit}
        if limit not in (None, "") and eligibility_gross > D(limit):
            return (
                ZERO,
                f"Not eligible: gross {eligibility_gross} above ESI limit {limit}",
                "",
                inputs,
            )
        amount = D(ctx.get("esi_wage")) * rate / HUNDRED
        if params.get("rounding") == "round_up":
            amount = round_money(amount, "round_up")
        return amount, f"{rate}% of ESI wage", "ESI_WAGE × RATE%", inputs

    if code == "PT":
        gross = D(ctx.get("gross"))
        month = str(ctx.get("month", ""))
        overrides = params.get("month_overrides") or {}
        for slab in params.get("slabs", []):
            low = D(slab.get("from"))
            high = slab.get("to")
            if gross >= low and (high in (None, "") or gross <= D(high)):
                amount = D(slab.get("amount"))
                if amount > 0 and month in overrides:
                    amount = D(overrides[month])
                return (
                    amount,
                    (
                        f"State slab {low}–{high if high not in (None, '') else 'above'} "
                        f"on gross {gross}"
                    ),
                    "PT slab(GROSS)",
                    {"gross": str(gross), "month": month, "state": rule.get("state", "")},
                )
        return ZERO, f"No PT slab matches gross {gross}", "", {"gross": str(gross)}

    if code in ("LWF_EMPLOYEE", "LWF_EMPLOYER"):
        months = [int(m) for m in params.get("months", [])]
        month = int(ctx.get("month") or 0)
        if months and month not in months:
            return ZERO, f"LWF not deducted in month {month}", "", {"months": months}
        return D(params.get("amount")), "Configured LWF amount", "AMOUNT", {"months": months}

    if code == "TDS":
        if params.get("method") == "flat_rate":
            rate = D(params.get("rate_pct"))
            taxable = D(ctx.get("taxable_gross"))
            return (
                taxable * rate / HUNDRED,
                f"Placeholder TDS: {rate}% of taxable earnings (MVP framework, not a tax engine)",
                "TAXABLE_GROSS × RATE%",
                {"taxable_gross": str(taxable), "rate_pct": str(rate)},
            )
        return ZERO, "TDS is entered manually for this period (MVP)", "", {}

    if code == "GRATUITY":
        base_code = params.get("base_component", "BASIC")
        base = D((ctx.get("components") or {}).get(base_code))
        rate = D(params.get("rate_pct"))
        return (
            base * rate / HUNDRED,
            f"{rate}% of {base_code}",
            f"{base_code} × RATE%",
            {
                "base": str(base),
                "rate_pct": str(rate),
            },
        )

    return ZERO, f"No calculation defined for rule {code}", "", {}
