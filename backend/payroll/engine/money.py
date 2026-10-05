"""Decimal helpers. Money is never a float (Calculation Rules §9): values keep
4 decimal places until a component's configured rounding point."""

from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
ONE = Decimal("1")
HUNDRED = Decimal("100")
P4 = Decimal("0.0001")
P2 = Decimal("0.01")


def D(value) -> Decimal:
    """Decimal from a model value, JSON string or int. Floats go through str()
    so 0.1 stays 0.1; None and '' are zero."""
    if value is None or value == "":
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def q4(value) -> Decimal:
    return D(value).quantize(P4, rounding=ROUND_HALF_UP)


def round_money(value, rule: str = "nearest_rupee") -> Decimal:
    value = D(value)
    if rule == "paise":
        return value.quantize(P2, rounding=ROUND_HALF_UP)
    if rule == "round_up":
        return value.quantize(ONE, rounding=ROUND_CEILING).quantize(P2)
    if rule == "round_down":
        return value.quantize(ONE, rounding=ROUND_FLOOR).quantize(P2)
    return value.quantize(ONE, rounding=ROUND_HALF_UP).quantize(P2)


def money_str(value) -> str:
    """Decimal-safe JSON representation (API contract §3)."""
    return str(D(value).quantize(P2, rounding=ROUND_HALF_UP))


def pct(part, whole) -> Decimal:
    whole = D(whole)
    if whole == 0:
        return ZERO
    return (D(part) * HUNDRED / whole).quantize(P2, rounding=ROUND_HALF_UP)
