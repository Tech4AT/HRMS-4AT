"""A small, safe formula language for component configuration (PAY-FR-004).

Formulas are parsed with Python's `ast` and only a whitelist of nodes is
evaluated: numbers, variable names, + - * / ( ), comparisons, `a if c else b`
and the functions min, max, round, abs, floor, ceil. Nothing is ever passed to
eval(). All arithmetic is Decimal.

Variables are component codes (e.g. BASIC, HRA) plus context names such as
CTC (annual), CTC_M (monthly), GROSS, PD, WD, LOP, U (units) and RATE.
"""

import ast
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal, InvalidOperation

from .money import D

CONTEXT_VARIABLES = {"CTC", "CTC_M", "GROSS", "PD", "WD", "LOP", "U", "RATE"}
FUNCTIONS = {"min", "max", "round", "abs", "floor", "ceil"}


class FormulaError(ValueError):
    pass


_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.Call,
    ast.Compare,
    ast.IfExp,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.USub,
    ast.UAdd,
    ast.Gt,
    ast.GtE,
    ast.Lt,
    ast.LtE,
    ast.Eq,
    ast.NotEq,
)


def parse(expr: str) -> ast.Expression:
    if not expr or not expr.strip():
        raise FormulaError("Formula is empty.")
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"Formula is not valid: {exc.msg}.") from exc
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise FormulaError(f"'{type(node).__name__}' is not allowed in a formula.")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
                raise FormulaError("Only min, max, round, abs, floor and ceil can be called.")
            if node.keywords:
                raise FormulaError("Keyword arguments are not allowed in a formula.")
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise FormulaError("Only numbers are allowed as constants.")
    return tree


def references(expr: str) -> set:
    """Variable names a formula reads (function names excluded)."""
    tree = parse(expr)
    funcs = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call)}
    return {
        n.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Name) and not (n.id in funcs and n.id in FUNCTIONS)
    }


def validate(expr: str, known_codes: set) -> set:
    """Raise FormulaError on syntax errors or unknown references; return refs."""
    refs = references(expr)
    unknown = sorted(r for r in refs if r not in known_codes and r not in CONTEXT_VARIABLES)
    if unknown:
        raise FormulaError(f"Unknown reference(s): {', '.join(unknown)}.")
    return refs


def evaluate(expr: str, variables: dict) -> Decimal:
    tree = parse(expr)
    try:
        return D(_eval(tree.body, variables))
    except (InvalidOperation, ZeroDivisionError) as exc:
        raise FormulaError(f"Formula could not be evaluated: {exc.__class__.__name__}.") from exc


def _eval(node, env):
    if isinstance(node, ast.Constant):
        return D(node.value)
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise FormulaError(f"Unknown reference: {node.id}.")
        return D(env[node.id])
    if isinstance(node, ast.UnaryOp):
        value = _eval(node.operand, env)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        left, right = _eval(node.left, env), _eval(node.right, env)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if right == 0:
            return D(0)  # a zero denominator (e.g. WD=0) yields 0, never a crash
        return left / right
    if isinstance(node, ast.Compare):
        left = _eval(node.left, env)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval(comparator, env)
            ok = {
                ast.Gt: left > right,
                ast.GtE: left >= right,
                ast.Lt: left < right,
                ast.LtE: left <= right,
                ast.Eq: left == right,
                ast.NotEq: left != right,
            }[type(op)]
            if not ok:
                return D(0)
            left = right
        return D(1)
    if isinstance(node, ast.BoolOp):
        values = [_eval(v, env) for v in node.values]
        if isinstance(node.op, ast.And):
            return D(1) if all(values) else D(0)
        return D(1) if any(values) else D(0)
    if isinstance(node, ast.IfExp):
        return _eval(node.body, env) if _eval(node.test, env) else _eval(node.orelse, env)
    if isinstance(node, ast.Call):
        args = [_eval(a, env) for a in node.args]
        name = node.func.id
        if name == "min":
            return min(args)
        if name == "max":
            return max(args)
        if name == "abs":
            return abs(args[0])
        if name == "floor":
            return args[0].quantize(D(1), rounding=ROUND_FLOOR)
        if name == "ceil":
            return args[0].quantize(D(1), rounding=ROUND_CEILING)
        if name == "round":
            places = int(args[1]) if len(args) > 1 else 0
            return args[0].quantize(D(1).scaleb(-places), rounding=ROUND_HALF_UP)
    raise FormulaError("Unsupported expression.")
