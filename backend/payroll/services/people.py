"""PAY-003 Employee Payroll Profile and PAY-004 / PAY-005 Compensation
assignment and effective-dated revision with maker-checker approval."""

import datetime

from django.db import transaction
from django.utils import timezone

from payroll import models as m
from payroll.integrations import approvals_bridge

from . import config as config_service
from .common import (
    PayrollError,
    audit,
    check_version,
    conflict,
    diff,
    employee_card,
    forbidden,
    invalid,
    mask,
    snapshot,
)

# ------------------------------------------------------------------ profiles

PROFILE_FIELDS = [
    "pay_group",
    "payroll_status",
    "work_state",
    "tax_regime",
    "pf_applicable",
    "esi_applicable",
    "pt_applicable",
    "lwf_applicable",
    "payment_mode",
    "payroll_start_date",
    "payroll_end_date",
    "remarks",
]


def profile_for(employee, as_of=None):
    as_of = as_of or datetime.date.today()
    qs = m.EmployeePayrollProfile.objects.filter(employee=employee, effective_from__lte=as_of)
    found = (
        qs.filter(effective_to__isnull=True).order_by("-effective_from").first()
        or qs.filter(effective_to__gte=as_of).order_by("-effective_from").first()
    )
    if found:
        return found
    # A profile that starts after `as_of` still describes a future joiner.
    return (
        m.EmployeePayrollProfile.objects.filter(employee=employee)
        .order_by("effective_from")
        .first()
    )


@transaction.atomic
def save_profile(employee, data, actor):
    """Create or change the payroll profile. The same effective date edits the
    current row (version-checked); a later date closes it and starts a new one
    so history is preserved (effective dating, PAY-003)."""
    effective_from = data.get("effective_from") or employee.date_of_joining or datetime.date.today()
    if isinstance(effective_from, str):
        effective_from = datetime.date.fromisoformat(effective_from)
    current = m.EmployeePayrollProfile.objects.filter(
        employee=employee, effective_to__isnull=True
    ).first()
    fields = {f: data[f] for f in PROFILE_FIELDS if f in data}
    if current is None:
        fields.setdefault("payroll_start_date", employee.date_of_joining)
        profile = m.EmployeePayrollProfile.objects.create(
            employee=employee,
            effective_from=effective_from,
            created_by=actor,
            updated_by=actor,
            **fields,
        )
        audit(actor, "profile.created", profile, changes={"new": snapshot(profile)})
        return profile
    check_version(current, data.get("version"))
    before = snapshot(current)
    if effective_from < current.effective_from:
        raise invalid(
            "A change cannot start before the current profile's effective date "
            f"({current.effective_from}).",
            {"effective_from": ["Too early."]},
        )
    if effective_from == current.effective_from:
        for field, value in fields.items():
            setattr(current, field, value)
        current.version += 1
        current.updated_by = actor
        current.save()
        audit(actor, "profile.updated", current, changes=diff(before, snapshot(current)))
        return current
    current.effective_to = effective_from - datetime.timedelta(days=1)
    current.save(update_fields=["effective_to", "updated_at"])
    carry = {f: getattr(current, f) for f in PROFILE_FIELDS}
    carry.update(fields)
    profile = m.EmployeePayrollProfile.objects.create(
        employee=employee,
        effective_from=effective_from,
        version=current.version + 1,
        created_by=actor,
        updated_by=actor,
        **carry,
    )
    audit(
        actor,
        "profile.revised",
        profile,
        changes=diff(before, snapshot(profile)),
        effective_from=effective_from,
    )
    return profile


def missing_profile_fields(employee, profile=None):
    """Mandatory payroll data that is missing (surfaced as validations)."""
    profile = profile or profile_for(employee)
    missing = []
    if profile is None:
        return ["payroll profile"]
    if not profile.pay_group_id:
        missing.append("pay group")
    if not profile.work_state:
        missing.append("work state")
    if profile.payment_mode == "bank_transfer":
        info = getattr(employee, "payroll_payment_info", None)
        if info is None or not info.bank_account_number or not info.bank_ifsc_code:
            missing.append("bank details")
    statutory = getattr(employee, "payroll_statutory_info", None)
    if statutory is None or not statutory.pan_number:
        missing.append("PAN")
    if profile.pf_applicable and (statutory is None or not statutory.uan_number):
        missing.append("UAN")
    return missing


def bank_and_statutory(employee, can_see_sensitive):
    info = getattr(employee, "payroll_payment_info", None)
    stat = getattr(employee, "payroll_statutory_info", None)
    reveal = (lambda v: v or "") if can_see_sensitive else mask
    return {
        "bank": (
            None
            if info is None
            else {
                "id": str(info.pk),
                "payment_method": info.payment_method,
                "bank_name": info.bank_name,
                "bank_account_number": reveal(info.bank_account_number),
                "bank_ifsc_code": info.bank_ifsc_code,
                "bank_account_holder_name": info.bank_account_holder_name,
                "is_masked": not can_see_sensitive,
            }
        ),
        "statutory": (
            None
            if stat is None
            else {
                "id": str(stat.pk),
                "pan_number": reveal(stat.pan_number),
                "uan_number": reveal(stat.uan_number),
                "pf_number": reveal(stat.pf_number),
                "esi_number": reveal(stat.esi_number),
                "professional_tax_state": stat.professional_tax_state,
                "lwf_applicable": stat.lwf_applicable,
                "is_masked": not can_see_sensitive,
            }
        ),
    }


@transaction.atomic
def save_bank_and_statutory(employee, data, actor):
    bank = data.get("bank")
    if bank:
        info = getattr(employee, "payroll_payment_info", None)
        before = snapshot(info) if info else {}
        info = info or m.EmployeePaymentInfo(employee=employee, payment_method="direct_deposit")
        for field in (
            "payment_method",
            "bank_name",
            "bank_account_number",
            "bank_ifsc_code",
            "bank_account_holder_name",
        ):
            if field in bank and not str(bank[field]).startswith("X"):
                setattr(info, field, bank[field])
        if info.bank_ifsc_code and len(info.bank_ifsc_code) != 11:
            raise invalid("IFSC code must be 11 characters.", {"bank_ifsc_code": ["Invalid IFSC."]})
        info.save()
        audit(
            actor,
            "bank_details.saved",
            info,
            changes={k: "changed" for k in diff(before, snapshot(info))},
        )
    stat = data.get("statutory")
    if stat:
        info = getattr(employee, "payroll_statutory_info", None)
        before = snapshot(info) if info else {}
        info = info or m.EmployeeStatutoryInfo(employee=employee)
        for field in (
            "pan_number",
            "uan_number",
            "pf_number",
            "esi_number",
            "professional_tax_state",
            "lwf_applicable",
            "professional_tax_exempt",
        ):
            if field in stat and not str(stat[field]).startswith("X"):
                setattr(info, field, stat[field])
        if info.pan_number:
            info.pan_number = info.pan_number.upper()
            if len(info.pan_number) != 10:
                raise invalid("PAN must be 10 characters.", {"pan_number": ["Invalid PAN."]})
        elif not info.pk:
            raise invalid("PAN is required.", {"pan_number": ["Required."]})
        info.save()
        audit(
            actor,
            "statutory_details.saved",
            info,
            changes={k: "changed" for k in diff(before, snapshot(info))},
        )


# -------------------------------------------------------------- compensation


def current_compensation(employee, as_of=None):
    as_of = as_of or datetime.date.today()
    qs = m.EmployeeCompensation.objects.filter(employee=employee).exclude(status="cancelled")
    found = (
        qs.filter(effective_from__lte=as_of)
        .filter(models_q_open(as_of))
        .order_by("-effective_from")
        .first()
    )
    return found or qs.filter(effective_from__gt=as_of).order_by("effective_from").first()


def models_q_open(as_of):
    from django.db.models import Q

    return Q(effective_to__isnull=True) | Q(effective_to__gte=as_of)


def applicability_for(employee, as_of=None):
    profile = profile_for(employee, as_of)
    if profile is None:
        return {"pf": True, "esi": False, "pt": True, "lwf": False, "state": ""}
    return {
        "pf": profile.pf_applicable,
        "esi": profile.esi_applicable,
        "pt": profile.pt_applicable,
        "lwf": profile.lwf_applicable,
        "state": profile.work_state,
    }


def compute_employee_breakup(employee, structure, annual_ctc, as_of):
    lines, _ = (
        config_service.lines_for(structure, as_of)
        if structure.status == "active"
        else (config_service.live_lines(structure), structure.version)
    )
    return config_service.preview_structure(
        lines,
        annual_ctc,
        as_of=as_of,
        tolerance=structure.ctc_tolerance,
        applicability=applicability_for(employee, as_of),
    )


def _validate_revision(employee, structure, annual_ctc, effective_from, exclude=None):
    errors = {}
    if structure.status != "active":
        errors["structure"] = ["Choose an active salary structure."]
    try:
        ctc = float(annual_ctc)
    except (TypeError, ValueError):
        ctc = 0
    if ctc <= 0:
        errors["annual_ctc"] = ["Annual CTC must be greater than zero."]
    elif (
        structure.min_ctc
        and ctc < float(structure.min_ctc)
        or structure.max_ctc
        and ctc > float(structure.max_ctc)
    ):
        errors["annual_ctc"] = [
            f"{structure.code} is for CTC between {structure.min_ctc or 0} "
            f"and {structure.max_ctc or 'any'}."
        ]
    if employee.date_of_joining and effective_from < employee.date_of_joining:
        errors["effective_from"] = [
            f"Cannot start before the date of joining ({employee.date_of_joining})."
        ]
    if (
        m.PayrollRun.objects.filter(
            status__in=("finalized",),
            period__start_date__lte=effective_from,
            period__end_date__gte=effective_from,
            results__employee=employee,
        ).exists()
        or m.PayrollRun.objects.filter(
            status="finalized", period__end_date__gte=effective_from, results__employee=employee
        ).exists()
    ):
        errors.setdefault("effective_from", []).append(
            "Payroll is already finalized for this date. Retroactive changes are paid as "
            "arrears in a later period: choose the next open period's start date and add "
            "an arrears input."
        )
    pending = m.CompensationRevision.objects.filter(
        employee=employee, status__in=("draft", "pending_approval", "returned")
    ).exclude(pk=getattr(exclude, "pk", None))
    if pending.exists():
        errors["employee"] = [
            "This employee already has an open revision. Finish or cancel it first."
        ]
    if errors:
        raise invalid("The compensation change could not be saved.", errors)


@transaction.atomic
def create_revision(employee, data, actor):
    structure = data["structure"]
    effective_from = data["effective_from"]
    _validate_revision(employee, structure, data["annual_ctc"], effective_from)
    preview = compute_employee_breakup(employee, structure, data["annual_ctc"], effective_from)
    if not preview["valid"]:
        raise invalid(
            "The salary structure does not reconcile at this CTC.",
            {"annual_ctc": preview["errors"]},
        )
    current = current_compensation(employee, effective_from)
    revision_type = data.get("revision_type") or (
        "new_assignment" if current is None else "annual_revision"
    )
    revision = m.CompensationRevision.objects.create(
        employee=employee,
        revision_type=revision_type,
        current_compensation=current,
        structure=structure,
        annual_ctc=data["annual_ctc"],
        effective_from=effective_from,
        reason=data.get("reason", ""),
        remarks=data.get("remarks", ""),
        breakup=preview,
        created_by=actor,
        updated_by=actor,
    )
    audit(
        actor,
        "compensation_revision.created",
        revision,
        changes={"new": snapshot(revision, exclude=("breakup",))},
    )
    if data.get("submit"):
        submit_revision(revision, actor)
    return revision


@transaction.atomic
def update_revision(revision, data, actor):
    if revision.status not in ("draft", "returned"):
        raise conflict("Only a draft or returned revision can be edited.", code="PAY_INVALID_STATE")
    check_version(revision, data.get("version"))
    before = snapshot(revision, exclude=("breakup",))
    for field in (
        "structure",
        "annual_ctc",
        "effective_from",
        "reason",
        "remarks",
        "revision_type",
    ):
        if field in data:
            setattr(revision, field, data[field])
    _validate_revision(
        revision.employee,
        revision.structure,
        revision.annual_ctc,
        revision.effective_from,
        exclude=revision,
    )
    revision.breakup = compute_employee_breakup(
        revision.employee, revision.structure, revision.annual_ctc, revision.effective_from
    )
    revision.version += 1
    revision.updated_by = actor
    revision.save()
    audit(
        actor,
        "compensation_revision.updated",
        revision,
        changes=diff(before, snapshot(revision, exclude=("breakup",))),
    )
    return revision


def approval_stages():
    return ["finance_review", "final_approval"]


STAGE_PERMISSION = {"finance_review": "payroll.review", "final_approval": "payroll.approve"}


@transaction.atomic
def submit_revision(revision, actor):
    if revision.status not in ("draft", "returned"):
        raise conflict("This revision has already been submitted.", code="PAY_INVALID_STATE")
    revision.approvals.filter(status="pending").update(status="cancelled")
    m.PayrollApproval.objects.create(
        revision=revision,
        stage="prepared",
        sequence=0,
        status="approved",
        approver=actor,
        acted_at=timezone.now(),
        comments="Prepared",
    )
    for index, stage in enumerate(approval_stages(), start=1):
        m.PayrollApproval.objects.create(revision=revision, stage=stage, sequence=index)
    revision.status = "pending_approval"
    revision.submitted_at = timezone.now()
    revision.version += 1
    revision.save()
    audit(actor, "compensation_revision.submitted", revision)
    approvals_bridge.open_next_stage(revision)
    return revision


def pending_stage(obj):
    return obj.approvals.filter(status="pending").order_by("sequence").first()


@transaction.atomic
def decide_revision(revision, actor, decision, comments, user_has_permission, from_inbox=False):
    if revision.status != "pending_approval":
        raise conflict("This revision is not awaiting approval.", code="PAY_INVALID_STATE")
    stage = pending_stage(revision)
    if stage is None:
        raise conflict("No approval stage is pending.", code="PAY_INVALID_STATE")
    if not user_has_permission(actor, STAGE_PERMISSION[stage.stage]):
        raise forbidden(f"You cannot act on the {stage.get_stage_display()} stage.")
    if revision.created_by_id == actor.pk:
        raise forbidden("Maker-checker: you cannot approve a revision you prepared.")
    if decision not in ("approve", "reject", "return"):
        raise invalid("Decision must be approve, reject or return.")
    if decision != "approve" and not (comments or "").strip():
        raise invalid("A comment is required to reject or return.", {"comments": ["Required."]})
    stage.status = {"approve": "approved", "reject": "rejected", "return": "returned"}[decision]
    stage.approver = actor
    stage.comments = comments or ""
    stage.acted_at = timezone.now()
    stage.save()
    if not from_inbox:
        approvals_bridge.close_stage(
            stage, actor, "approve" if decision == "approve" else "reject", comments
        )
    if decision == "approve":
        if pending_stage(revision) is None:
            apply_revision(revision, actor)
        audit(actor, f"compensation_revision.{stage.stage}.approved", revision, reason=comments)
        approvals_bridge.open_next_stage(revision)
    else:
        revision.status = "rejected" if decision == "reject" else "returned"
        revision.decided_at = timezone.now()
        revision.approvals.filter(status="pending").update(status="cancelled")
        revision.version += 1
        revision.save()
        audit(actor, f"compensation_revision.{revision.status}", revision, reason=comments)
    return revision


@transaction.atomic
def apply_revision(revision, actor):
    """Create the new effective-dated compensation and close the previous one.
    Prior rows are never edited beyond their end date (PAY-FR-007)."""
    employee = revision.employee
    effective_from = revision.effective_from
    later = m.EmployeeCompensation.objects.filter(
        employee=employee, status="active", effective_from__gte=effective_from
    )
    if later.exists():
        raise conflict(
            "A compensation already starts on or after this date. Cancel or correct it first.",
            code="PAY_INVALID_STATE",
        )
    previous = (
        m.EmployeeCompensation.objects.filter(
            employee=employee, status="active", effective_from__lt=effective_from
        )
        .filter(models_q_open(effective_from))
        .order_by("-effective_from")
        .first()
    )
    if previous:
        previous.effective_to = effective_from - datetime.timedelta(days=1)
        previous.save(update_fields=["effective_to"])
    _, structure_version = config_service.lines_for(revision.structure, effective_from)
    last = m.EmployeeCompensation.objects.filter(employee=employee).order_by("-version_no").first()
    compensation = m.EmployeeCompensation.objects.create(
        employee=employee,
        version_no=(last.version_no + 1) if last else 1,
        structure=revision.structure,
        structure_version=structure_version,
        annual_ctc=revision.annual_ctc,
        effective_from=effective_from,
        revision=revision,
        revision_type=revision.revision_type,
        reason=revision.reason,
        breakup=revision.breakup,
        created_by=revision.created_by,
        approved_by=actor,
    )
    revision.status = "approved"
    revision.decided_at = timezone.now()
    revision.resulting_compensation = compensation
    revision.version += 1
    revision.save()
    audit(
        actor,
        "compensation.approved",
        compensation,
        changes={
            "new": snapshot(compensation, exclude=("breakup",)),
            "previous": str(previous.pk) if previous else None,
        },
    )
    return compensation


@transaction.atomic
def cancel_revision(revision, actor, reason=""):
    if revision.status not in ("draft", "returned", "pending_approval"):
        raise conflict("Only an open revision can be cancelled.", code="PAY_INVALID_STATE")
    approvals_bridge.cancel_open(revision, actor)
    revision.status = "cancelled"
    revision.approvals.filter(status="pending").update(status="cancelled")
    revision.version += 1
    revision.save()
    audit(actor, "compensation_revision.cancelled", revision, reason=reason)
    return revision


def compensation_summary(employee):
    today = datetime.date.today()
    current = current_compensation(employee, today)
    history = list(
        m.EmployeeCompensation.objects.filter(employee=employee).order_by("-effective_from")
    )
    previous = None
    if current:
        previous = next((c for c in history if c.effective_from < current.effective_from), None)
    return {
        "employee": employee_card(employee),
        "current": current,
        "previous": previous,
        "history": history,
    }


def ensure_structure_assignable(structure):
    if structure.status != "active":
        raise PayrollError("PAY_INVALID_REQUEST", "Choose an active salary structure.")
