"""PAY-001 Salary Component Master and PAY-002 Salary Structure Builder.

Every change writes an immutable version snapshot and an audit entry; nothing
a historical payroll depended on is ever overwritten. A component change
re-versions each active structure that uses it, effective from the change
date, so payroll picks the change up from that date and not before."""

import datetime
import re

from django.db import transaction

from payroll import models as m
from payroll.engine import formula as formula_engine
from payroll.engine.breakup import BreakupError, compute_breakup, validate_structure_lines

from .common import audit, check_version, conflict, diff, invalid, jsonable, snapshot

CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,39}$")

COMPONENT_FIELDS = [
    "code",
    "name",
    "payslip_label",
    "description",
    "component_type",
    "category",
    "calculation_type",
    "value",
    "base_component_code",
    "formula_expr",
    "statutory_rule_code",
    "is_taxable",
    "include_in_pf_wage",
    "include_in_esi_wage",
    "part_of_ctc",
    "part_of_gross",
    "part_of_net",
    "is_proratable",
    "is_lop_applicable",
    "show_on_payslip",
    "rounding",
    "applicability",
    "display_order",
    "status",
    "effective_from",
    "effective_to",
]
CONFIG_FIELDS = [f for f in COMPONENT_FIELDS if f not in ("status", "effective_to")]
STATUTORY_CODES = {code for code, _ in m.StatutoryRule.CODE_CHOICES}


# ----------------------------------------------------------------- components


def component_config(component, version=None) -> dict:
    """The engine's view of a component: plain data, used for version
    snapshots and as a structure line's defaults."""
    data = {f: getattr(component, f) for f in CONFIG_FIELDS}
    data["component_id"] = str(component.pk)
    data["component_version"] = version or component.version
    return jsonable(data)


def normalise_component(data: dict) -> dict:
    data = dict(data)
    if "code" in data and data["code"]:
        data["code"] = data["code"].strip().upper().replace(" ", "_")
    if data.get("base_component_code"):
        data["base_component_code"] = data["base_component_code"].strip().upper()
    kind = data.get("component_type")
    if kind == "deduction":
        data["part_of_ctc"] = False
        data["part_of_gross"] = False
        data["include_in_pf_wage"] = False
        data["include_in_esi_wage"] = False
    if kind == "employer_contribution":
        data["part_of_gross"] = False
        data["part_of_net"] = False
        data["include_in_pf_wage"] = False
        data["include_in_esi_wage"] = False
    if data.get("calculation_type") not in ("percent_of_component",):
        data.setdefault("base_component_code", "")
    return data


def validate_component(data: dict, instance=None) -> None:
    errors = {}
    code = data.get("code") or (instance.code if instance else "")
    kind = data.get("component_type")
    calc = data.get("calculation_type")

    if not CODE_RE.match(code or ""):
        errors["code"] = [
            "Use 2-40 capital letters, digits or underscores, starting with a letter."
        ]
    elif (
        m.SalaryComponent.objects.filter(code=code)
        .exclude(pk=getattr(instance, "pk", None))
        .exists()
    ):
        errors["code"] = [f"Component code {code} already exists."]
    if not (data.get("name") or "").strip():
        errors["name"] = ["Name is required."]
    if kind not in dict(m.SalaryComponent.TYPE_CHOICES):
        errors["component_type"] = ["Choose earning, deduction or employer contribution."]
    if calc not in dict(m.SalaryComponent.CALCULATION_CHOICES):
        errors["calculation_type"] = ["Choose a calculation type."]
    if calc in ("fixed", "percent_of_ctc", "percent_of_component") and data.get("value") in (
        None,
        "",
    ):
        errors["value"] = ["A value is required for this calculation type."]
    if calc in ("percent_of_ctc", "percent_of_component") and data.get("value") not in (None, ""):
        if not (0 <= float(data["value"]) <= 100):
            errors["value"] = ["A percentage must be between 0 and 100."]
    if calc == "percent_of_component":
        base = data.get("base_component_code") or "BASIC"
        if base == code:
            errors["base_component_code"] = ["A component cannot be a percentage of itself."]
        elif not m.SalaryComponent.objects.filter(code=base).exists():
            errors["base_component_code"] = [f"Base component {base} does not exist."]
    if calc == "formula":
        expr = data.get("formula_expr") or ""
        known = set(m.SalaryComponent.objects.values_list("code", flat=True)) | {code}
        try:
            refs = formula_engine.validate(expr, known)
            if code in refs:
                errors["formula_expr"] = ["A formula cannot refer to its own component."]
            else:
                _check_component_cycles(code, refs)
        except (formula_engine.FormulaError, BreakupError) as exc:
            errors["formula_expr"] = [str(exc)]
    if calc == "rule_based":
        if data.get("statutory_rule_code") not in STATUTORY_CODES:
            errors["statutory_rule_code"] = ["Choose the statutory rule this component uses."]
        if kind == "earning":
            errors["calculation_type"] = [
                "Rule-based components are deductions or employer contributions."
            ]
    if calc == "balancing" and kind != "earning":
        errors["calculation_type"] = ["Only an earning can be the balancing component."]
    if (
        data.get("effective_to")
        and data.get("effective_from")
        and data["effective_to"] < data["effective_from"]
    ):
        errors["effective_to"] = ["Effective to must be on or after effective from."]
    if errors:
        raise invalid("The component could not be saved.", errors)


def _check_component_cycles(code, refs):
    """Walk formula / %-of references across component defaults."""
    graph = {}
    for comp in m.SalaryComponent.objects.all():
        if comp.calculation_type == "formula" and comp.formula_expr:
            try:
                graph[comp.code] = formula_engine.references(comp.formula_expr)
            except formula_engine.FormulaError:
                graph[comp.code] = set()
        elif comp.calculation_type == "percent_of_component":
            graph[comp.code] = {comp.base_component_code or "BASIC"}
    graph[code] = set(refs)

    def walk(node, path):
        if node in path:
            cycle = path[path.index(node) :] + [node]
            raise BreakupError(f"Circular reference: {' → '.join(cycle)}.")
        for nxt in graph.get(node, ()):
            walk(nxt, path + [node])

    walk(code, [])


def _write_component_version(component, actor, reason, effective_from):
    return m.SalaryComponentVersion.objects.create(
        component=component,
        version=component.version,
        effective_from=effective_from,
        config=component_config(component),
        change_reason=reason,
        created_by=actor,
    )


@transaction.atomic
def create_component(data, actor):
    data = normalise_component(data)
    data.setdefault("status", "active")
    data.setdefault("payslip_label", data.get("name", ""))
    validate_component(data)
    fields = {f: data[f] for f in COMPONENT_FIELDS if f in data}
    component = m.SalaryComponent.objects.create(created_by=actor, updated_by=actor, **fields)
    _write_component_version(component, actor, "Created", component.effective_from)
    audit(actor, "component.created", component, changes={"new": snapshot(component)})
    return component


@transaction.atomic
def update_component(component, data, actor, reason=""):
    check_version(component, data.get("version"))
    before = snapshot(component)
    merged = {f: getattr(component, f) for f in COMPONENT_FIELDS}
    merged.update({k: v for k, v in data.items() if k in COMPONENT_FIELDS})
    if merged["code"] != component.code and component_used_in_payroll(component):
        raise invalid(
            "The code of a component used in payroll cannot change.", {"code": ["Locked."]}
        )
    merged = normalise_component(merged)
    validate_component(merged, instance=component)
    change_date = data.get("change_effective_from") or datetime.date.today()
    if isinstance(change_date, str):
        change_date = datetime.date.fromisoformat(change_date)
    for field in COMPONENT_FIELDS:
        setattr(component, field, merged[field])
    component.version += 1
    component.updated_by = actor
    component.save()
    _write_component_version(component, actor, reason or "Updated", change_date)
    changes = diff(before, snapshot(component))
    audit(
        actor,
        "component.updated",
        component,
        changes=changes,
        reason=reason,
        effective_from=change_date,
    )
    for structure in structures_using(component).filter(status="active"):
        write_structure_version(
            structure,
            actor,
            f"Component {component.code} updated",
            max(change_date, structure.effective_from),
        )
    return component


def structures_using(component):
    return m.SalaryStructure.objects.filter(lines__component=component).distinct()


def component_used_in_payroll(component):
    return m.PayrollResultComponent.objects.filter(component=component).exists()


@transaction.atomic
def set_component_status(component, new_status, actor, reason="", effective_date=None):
    if new_status not in ("active", "inactive"):
        raise invalid("Status must be active or inactive.")
    if new_status == component.status:
        return component
    before = snapshot(component)
    if new_status == "inactive":
        in_use = list(
            structures_using(component).filter(status="active").values_list("code", flat=True)
        )
        if in_use:
            raise conflict(
                f"{component.code} is used by active salary structure(s) {', '.join(in_use)}. "
                "Remove it from those structures (or deactivate them) first.",
                code="PAY_COMPONENT_IN_USE",
            )
        component.effective_to = effective_date or datetime.date.today()
    else:
        validate_component({f: getattr(component, f) for f in COMPONENT_FIELDS}, instance=component)
        component.effective_to = None
    component.status = new_status
    component.version += 1
    component.updated_by = actor
    component.save()
    _write_component_version(
        component,
        actor,
        f"Status changed to {new_status}. {reason}".strip(),
        effective_date or datetime.date.today(),
    )
    audit(
        actor,
        f"component.{'activated' if new_status == 'active' else 'deactivated'}",
        component,
        changes=diff(before, snapshot(component)),
        reason=reason,
    )
    return component


@transaction.atomic
def delete_component(component, actor):
    if (
        component.status != "draft"
        or structures_using(component).exists()
        or component_used_in_payroll(component)
    ):
        raise conflict(
            (
                "Only an unused draft component can be deleted. "
                "Deactivate it instead to keep its history."
            ),
            code="PAY_COMPONENT_IN_USE",
        )
    audit(actor, "component.deleted", component, changes={"old": snapshot(component)})
    component.delete()


# ----------------------------------------------------------------- structures

LINE_FIELDS = [
    "order",
    "calculation_type",
    "value",
    "base_component_code",
    "formula_expr",
    "is_mandatory",
]


def resolve_line(line, component, component_version=None) -> dict:
    config = component_config(component, component_version)
    for field in ("calculation_type", "base_component_code", "formula_expr"):
        value = getattr(line, field, None) if not isinstance(line, dict) else line.get(field)
        if value:
            config[field] = value
    value = line.value if not isinstance(line, dict) else line.get("value")
    if value not in (None, ""):
        config["value"] = str(value)
    config["order"] = line.order if not isinstance(line, dict) else line.get("order", 0)
    return config


def live_lines(structure) -> list:
    return [
        resolve_line(line, line.component)
        for line in structure.lines.select_related("component").order_by("order")
    ]


def draft_lines(line_payload) -> list:
    """Resolve an unsaved line list from the builder (component ids/codes)."""
    resolved = []
    for index, item in enumerate(line_payload or []):
        component = _find_component(item)
        entry = dict(item)
        entry.setdefault("order", index + 1)
        resolved.append(resolve_line(entry, component))
    return resolved


def _find_component(item):
    lookup = {}
    if item.get("component_id") or item.get("component"):
        lookup["pk"] = item.get("component_id") or item.get("component")
    elif item.get("component_code"):
        lookup["code"] = item["component_code"]
    else:
        raise invalid("Each structure line needs a component.")
    component = m.SalaryComponent.objects.filter(**lookup).first()
    if component is None:
        raise invalid(f"Component {lookup} does not exist.")
    return component


def structure_snapshot(structure, lines=None) -> dict:
    return jsonable(
        {
            "code": structure.code,
            "name": structure.name,
            "pay_frequency": structure.pay_frequency,
            "ctc_tolerance": structure.ctc_tolerance,
            "lines": lines if lines is not None else live_lines(structure),
        }
    )


def write_structure_version(structure, actor, reason, effective_from):
    latest = structure.versions.order_by("-version").first()
    version_no = (latest.version + 1) if latest else 1
    if structure.version < version_no:
        structure.version = version_no
        structure.save(update_fields=["version", "updated_at"])
    return m.SalaryStructureVersion.objects.create(
        structure=structure,
        version=version_no,
        effective_from=effective_from,
        snapshot=structure_snapshot(structure),
        change_reason=reason,
        created_by=actor,
    )


def structure_version_for(structure, as_of) -> "m.SalaryStructureVersion | None":
    qs = structure.versions.all()
    found = qs.filter(effective_from__lte=as_of).order_by("-effective_from", "-version").first()
    return found or qs.order_by("effective_from", "version").first()


def lines_for(structure, as_of):
    """(lines, version_no) the engine uses for `structure` on `as_of`."""
    version = structure_version_for(structure, as_of)
    if version is None:
        return live_lines(structure), structure.version
    return version.snapshot["lines"], version.version


def preview_structure(
    lines, annual_ctc, *, as_of=None, tolerance=1, applicability=None, strict=False
):
    as_of = as_of or datetime.date.today()
    problems = validate_structure_lines(lines)
    if problems:
        return {"valid": False, "errors": problems, "lines": [], "totals": {}}
    try:
        result = compute_breakup(
            lines,
            annual_ctc,
            rules=statutory_rules_data(),
            as_of=as_of,
            applicability=applicability or {"pf": True, "esi": True, "pt": True, "lwf": False},
            tolerance=tolerance,
            strict=strict,
        )
    except (BreakupError, formula_engine.FormulaError) as exc:
        return {"valid": False, "errors": [str(exc)], "lines": [], "totals": {}}
    result["valid"] = not result["errors"]
    return jsonable(result)


def statutory_rules_data():
    return [
        jsonable(
            {
                "id": r.pk,
                "code": r.code,
                "state": r.state,
                "legal_entity_id": r.legal_entity_id,
                "params": r.params,
                "status": r.status,
                "version": r.version,
                "is_reviewed": r.is_reviewed,
                "effective_from": r.effective_from,
                "effective_to": r.effective_to,
            }
        )
        for r in m.StatutoryRule.objects.all()
    ]


STRUCTURE_FIELDS = [
    "code",
    "name",
    "description",
    "legal_entity",
    "pay_group",
    "pay_frequency",
    "min_ctc",
    "max_ctc",
    "eligibility",
    "reference_ctc",
    "ctc_tolerance",
    "effective_from",
    "effective_to",
]


def _validate_structure_meta(data, instance=None):
    errors = {}
    code = (data.get("code") or "").strip().upper()
    if not re.match(r"^[A-Z0-9][A-Z0-9_\-]{1,39}$", code):
        errors["code"] = ["Use 2-40 capital letters, digits, '-' or '_'."]
    elif (
        m.SalaryStructure.objects.filter(code=code)
        .exclude(pk=getattr(instance, "pk", None))
        .exists()
    ):
        errors["code"] = [f"Structure code {code} already exists."]
    if not (data.get("name") or "").strip():
        errors["name"] = ["Name is required."]
    if not data.get("effective_from"):
        errors["effective_from"] = ["Effective from is required."]
    if (
        data.get("min_ctc")
        and data.get("max_ctc")
        and float(data["min_ctc"]) > float(data["max_ctc"])
    ):
        errors["max_ctc"] = ["Maximum CTC must be at least the minimum."]
    if errors:
        raise invalid("The salary structure could not be saved.", errors)
    data["code"] = code


def _save_lines(structure, line_payload):
    structure.lines.all().delete()
    for index, item in enumerate(line_payload or []):
        component = _find_component(item)
        m.SalaryStructureComponent.objects.create(
            structure=structure,
            component=component,
            order=item.get("order") or index + 1,
            calculation_type=item.get("calculation_type") or "",
            value=item.get("value") if item.get("value") not in ("", None) else None,
            base_component_code=(item.get("base_component_code") or "").upper(),
            formula_expr=item.get("formula_expr") or "",
            is_mandatory=item.get("is_mandatory", True),
        )


def _strict_check(structure):
    lines = live_lines(structure)
    inactive = [
        line["code"]
        for line in lines
        if m.SalaryComponent.objects.get(pk=line["component_id"]).status != "active"
    ]
    problems = validate_structure_lines(lines)
    if inactive:
        problems.append(f"Inactive component(s): {', '.join(inactive)}.")
    if problems:
        raise invalid("The structure is not valid.", {"lines": problems})
    for ctc in {structure.reference_ctc, structure.min_ctc, structure.max_ctc} - {None}:
        if ctc and ctc > 0:
            try:
                compute_breakup(
                    lines,
                    ctc,
                    rules=statutory_rules_data(),
                    as_of=structure.effective_from,
                    applicability={"pf": True, "esi": True, "pt": True},
                    tolerance=structure.ctc_tolerance,
                    strict=True,
                )
            except (BreakupError, formula_engine.FormulaError) as exc:
                raise invalid(f"At CTC {ctc}: {exc}", {"lines": [str(exc)]})


@transaction.atomic
def create_structure(data, actor):
    _validate_structure_meta(data)
    fields = {f: data[f] for f in STRUCTURE_FIELDS if f in data}
    structure = m.SalaryStructure.objects.create(
        status="draft", created_by=actor, updated_by=actor, **fields
    )
    _save_lines(structure, data.get("lines", []))
    if data.get("status") == "active":
        activate_structure(structure, actor, reason="Created active")
    audit(actor, "structure.created", structure, changes={"new": structure_snapshot(structure)})
    return structure


@transaction.atomic
def update_structure(structure, data, actor, reason=""):
    check_version(structure, data.get("version"))
    before = structure_snapshot(structure)
    merged = {f: getattr(structure, f) for f in STRUCTURE_FIELDS}
    merged.update({k: v for k, v in data.items() if k in STRUCTURE_FIELDS})
    _validate_structure_meta(merged, instance=structure)
    for field in STRUCTURE_FIELDS:
        setattr(structure, field, merged[field])
    structure.updated_by = actor
    structure.version += 1
    structure.save()
    if "lines" in data:
        _save_lines(structure, data["lines"])
    if structure.status == "active":
        _strict_check(structure)
        change_date = data.get("change_effective_from") or datetime.date.today()
        if isinstance(change_date, str):
            change_date = datetime.date.fromisoformat(change_date)
        write_structure_version(
            structure, actor, reason or "Updated", max(change_date, structure.effective_from)
        )
    audit(
        actor,
        "structure.updated",
        structure,
        changes=diff(before, structure_snapshot(structure)),
        reason=reason,
    )
    return structure


@transaction.atomic
def activate_structure(structure, actor, reason=""):
    _strict_check(structure)
    structure.status = "active"
    structure.effective_to = None
    structure.updated_by = actor
    structure.save()
    write_structure_version(
        structure,
        actor,
        reason or "Activated",
        structure.effective_from if not structure.versions.exists() else datetime.date.today(),
    )
    audit(actor, "structure.activated", structure, reason=reason)
    return structure


@transaction.atomic
def deactivate_structure(structure, actor, reason=""):
    in_use = m.EmployeeCompensation.objects.filter(structure=structure, status="active").count()
    if in_use:
        raise conflict(
            (
                f"{in_use} employee(s) are currently paid on "
                f"{structure.code}. Revise their compensation first."
            ),
            code="PAY_STRUCTURE_IN_USE",
        )
    structure.status = "inactive"
    structure.effective_to = datetime.date.today()
    structure.version += 1
    structure.updated_by = actor
    structure.save()
    audit(actor, "structure.deactivated", structure, reason=reason)
    return structure


@transaction.atomic
def clone_structure(structure, actor, code, name):
    data = {f: getattr(structure, f) for f in STRUCTURE_FIELDS}
    data.update({"code": code, "name": name, "effective_from": datetime.date.today()})
    data["lines"] = [
        {
            "component_id": line.component_id,
            "order": line.order,
            "calculation_type": line.calculation_type,
            "value": line.value,
            "base_component_code": line.base_component_code,
            "formula_expr": line.formula_expr,
            "is_mandatory": line.is_mandatory,
        }
        for line in structure.lines.all()
    ]
    return create_structure(data, actor)
