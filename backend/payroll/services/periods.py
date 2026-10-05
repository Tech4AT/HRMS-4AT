"""PAY-006 periods, PAY-007 attendance snapshot, PAY-008 OT, PAY-009
joiners/exits, PAY-010 variable pay & adjustments, holds and overrides.

Payroll consumes finalized source data; it never becomes a second attendance
system. When an attendance module is installed it is read through
`attendance.payroll_provider.period_summary(period)` (contract §5.2);
otherwise the payroll team imports or keys in the finalized summary."""

import csv
import datetime
import hashlib
import io
import json
from decimal import Decimal, InvalidOperation
from importlib import import_module

from django.apps import apps
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from employees.models import Employee
from payroll import models as m

from . import people
from .common import (
    audit,
    conflict,
    employee_card,
    ensure_unlocked,
    invalid,
    jsonable,
    month_bounds,
    snapshot,
)

STEPS = [
    ("attendance", "Attendance, Leave & Timesheets"),
    ("joiners_exits", "New Joiners & Exits"),
    ("revisions_variable", "Salary Revisions, Bonus & OT"),
    ("reimbursements", "Reimbursements & Deductions"),
    ("holds_adjustments", "Holds, Arrears & Adjustments"),
    ("statutory", "Statutory Deductions"),
    ("review", "Review & Finalize"),
]


# ------------------------------------------------------------------- periods


@transaction.atomic
def create_period(pay_group, year, month, actor, pay_date=None, working_days=None, cutoff_at=None):
    if m.PayrollPeriod.objects.filter(pay_group=pay_group, year=year, month=month).exists():
        raise conflict(f"{pay_group.code} {year}-{month:02d} already exists.", code="PAY_DUPLICATE")
    start, end = month_bounds(year, month)
    if pay_date is None:
        pay_date = (
            end if not pay_group.pay_day else start.replace(day=min(pay_group.pay_day, end.day))
        )
    if cutoff_at is None and pay_group.cutoff_day:
        cutoff_at = timezone.make_aware(
            datetime.datetime.combine(
                start.replace(day=min(pay_group.cutoff_day, end.day)), datetime.time(23, 59)
            )
        )
    period = m.PayrollPeriod.objects.create(
        pay_group=pay_group,
        year=year,
        month=month,
        start_date=start,
        end_date=end,
        pay_date=pay_date,
        cutoff_at=cutoff_at,
        working_days=working_days or pay_group.default_working_days,
        created_by=actor,
        updated_by=actor,
    )
    audit(actor, "period.created", period, changes={"new": snapshot(period)})
    return period


def touch(period, actor=None):
    """First activity moves a draft/reopened period to In Progress."""
    if period.status in ("draft",):
        period.status = "in_progress"
        period.save(update_fields=["status", "updated_at"])


@transaction.atomic
def set_step_status(period, step, status, actor):
    if step not in dict(STEPS):
        raise invalid(f"Unknown step {step}.")
    ensure_unlocked(period)
    period.step_status = {**(period.step_status or {}), step: status}
    touch(period)
    period.save(update_fields=["step_status", "status", "updated_at"])
    audit(actor, "period.step_updated", period, step=step, status=status)
    return period


def population(period):
    """Employees in this pay group who are payroll-eligible on any day of the
    period (profile effective in the period, not 'not_eligible')."""
    profiles = (
        m.EmployeePayrollProfile.objects.filter(
            pay_group=period.pay_group, effective_from__lte=period.end_date
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=period.start_date))
        .exclude(payroll_status="not_eligible")
    )
    ids = set(profiles.values_list("employee_id", flat=True))
    return (
        Employee.objects.filter(pk__in=ids)
        .filter(Q(date_of_joining__isnull=True) | Q(date_of_joining__lte=period.end_date))
        .filter(Q(date_of_exit__isnull=True) | Q(date_of_exit__gte=period.start_date))
        .select_related(
            "user", "department", "designation", "location", "legal_entity", "manager__user"
        )
        .order_by("employee_code")
    )


# ---------------------------------------------------------------- attendance


def _attendance_provider():
    """The attendance module's own provider if it ships one, else payroll's
    adapter over the attendance / leave / org_calendar apps when installed."""
    try:
        return import_module("attendance.payroll_provider")
    except ImportError:
        pass
    if all(apps.is_installed(app) for app in ("attendance", "leave", "org_calendar")):
        return import_module("payroll.integrations.attendance_source")
    return None


def _full_days(period):
    basis = period.pay_group.proration_basis
    if basis == "working_days":
        return Decimal(period.working_days)
    if basis == "fixed_30":
        return Decimal(30)
    return Decimal((period.end_date - period.start_date).days + 1)


def _days_for(employee, period):
    """Default payable days for an employee with no LOP (joiner/exit aware)."""
    full = _full_days(period)
    start = max(period.start_date, employee.date_of_joining or period.start_date)
    end = min(period.end_date, employee.date_of_exit or period.end_date)
    if start == period.start_date and end == period.end_date:
        return full, full
    days = Decimal((end - start).days + 1)
    period_days = Decimal((period.end_date - period.start_date).days + 1)
    if period.pay_group.proration_basis == "calendar_days":
        return full, days
    return full, (full * days / period_days).quantize(Decimal("0.01"))


@transaction.atomic
def sync_attendance(period, actor):
    """Pull the finalized summary from the attendance module when installed."""
    ensure_unlocked(period)
    provider = _attendance_provider()
    if provider is None:
        raise conflict(
            "No attendance module is connected. Import the finalized attendance summary (CSV) "
            "or enter it per employee.",
            code="PAY_SOURCE_UNAVAILABLE",
        )
    rows = provider.period_summary(period)
    count = 0
    for row in rows:
        _upsert_attendance(period, row["employee_id"], row, "attendance_module", actor)
        count += 1
    touch(period)
    audit(actor, "attendance.synced", period, rows=count)
    return count


def _upsert_attendance(period, employee_id, row, source, actor, reason=""):
    fields = {}
    for field in (
        "working_days",
        "payable_days",
        "present_days",
        "lop_days",
        "paid_leave_days",
        "unpaid_leave_days",
        "ot_hours",
        "pending_leave_requests",
    ):
        if row.get(field) not in (None, ""):
            fields[field] = (
                Decimal(str(row[field])) if field != "pending_leave_requests" else int(row[field])
            )
    employee = Employee.objects.get(pk=employee_id)
    default_wd, default_pd = _days_for(employee, period)
    fields.setdefault("working_days", default_wd)
    fields.setdefault("lop_days", Decimal(0))
    fields.setdefault("payable_days", max(Decimal(0), default_pd - fields["lop_days"]))
    fields.setdefault("present_days", fields["payable_days"])
    if fields["lop_days"] < 0 or fields["payable_days"] < 0:
        raise invalid("Days cannot be negative.")
    if fields["payable_days"] + fields["lop_days"] > fields["working_days"] + Decimal("0.001"):
        raise invalid(
            f"{employee.employee_code}: payable days ({fields['payable_days']}) "
            f"+ LOP ({fields['lop_days']}) exceed working days ({fields['working_days']})."
        )
    status = row.get("status") or "final"
    record, created = m.AttendancePayrollInput.objects.get_or_create(
        period=period,
        employee=employee,
        defaults={
            **fields,
            "source": source,
            "status": status,
            "updated_by": actor,
            "override_reason": reason,
        },
    )
    if not created:
        before = snapshot(record)
        for key, value in fields.items():
            setattr(record, key, value)
        record.status = status
        record.source = source
        record.override_reason = reason
        record.updated_by = actor
        record.snapshot = None
        record.save()
        audit(
            actor,
            "attendance.updated",
            record,
            changes={"before": before, "after": snapshot(record)},
            reason=reason,
        )
    else:
        audit(actor, "attendance.created", record, changes={"new": snapshot(record)})
    return record


@transaction.atomic
def save_attendance(period, employee_id, data, actor):
    ensure_unlocked(period)
    touch(period)
    return _upsert_attendance(
        period, employee_id, data, "manual", actor, data.get("override_reason", "")
    )


@transaction.atomic
def import_attendance_csv(period, text, actor):
    """Columns: employee_code, working_days, payable_days, lop_days,
    present_days, paid_leave_days, unpaid_leave_days, ot_hours, status."""
    ensure_unlocked(period)
    reader = csv.DictReader(io.StringIO(text))
    codes = {e.employee_code: e.pk for e in population(period)}
    created, errors = 0, []
    for number, row in enumerate(reader, start=2):
        code = (row.get("employee_code") or "").strip()
        if code not in codes:
            errors.append(
                {"row": number, "error": f"{code or '(blank)'} is not in this pay group's payroll."}
            )
            continue
        try:
            _upsert_attendance(period, codes[code], row, "import", actor)
            created += 1
        except (InvalidOperation, ValueError) as exc:
            errors.append({"row": number, "error": str(getattr(exc, "message", exc))})
        except Exception as exc:  # noqa: BLE001 - report the row, keep importing
            errors.append({"row": number, "error": getattr(exc, "message", str(exc))})
    touch(period)
    audit(actor, "attendance.imported", period, rows=created, errors=len(errors))
    return {"imported": created, "errors": errors}


@transaction.atomic
def fill_missing_attendance(period, actor):
    """Create full-attendance rows for everyone without one. Explicit action,
    audited, so it never happens silently."""
    ensure_unlocked(period)
    existing = set(period.attendance.values_list("employee_id", flat=True))
    count = 0
    for employee in population(period):
        if employee.pk not in existing:
            _upsert_attendance(
                period,
                employee.pk,
                {"status": "final"},
                "manual",
                actor,
                "Marked full attendance (no LOP)",
            )
            count += 1
    touch(period)
    audit(actor, "attendance.filled_missing", period, rows=count)
    return count


@transaction.atomic
def capture_snapshot(period, kind, actor):
    """Freeze the current inputs into an immutable, checksummed snapshot
    (API contract §5, `snapshot-inputs`)."""
    ensure_unlocked(period)
    latest = period.snapshots.filter(kind=kind).order_by("-version").first()
    version = (latest.version + 1) if latest else 1
    if kind == "attendance":
        rows = list(period.attendance.select_related("employee"))
        payload = {
            str(r.employee_id): jsonable(
                {
                    f: getattr(r, f)
                    for f in (
                        "working_days",
                        "payable_days",
                        "lop_days",
                        "present_days",
                        "paid_leave_days",
                        "unpaid_leave_days",
                        "ot_hours",
                        "status",
                    )
                }
            )
            for r in rows
        }
        is_final = all(r.status == "final" for r in rows) and bool(rows)
    elif kind == "employee":
        payload = {str(e.pk): employee_card(e) for e in population(period)}
        rows = list(payload)
        is_final = True
    else:
        raise invalid(f"Snapshot kind {kind} is not supported here.")
    checksum = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    snap = m.InputSnapshot.objects.create(
        period=period,
        kind=kind,
        version=version,
        source="payroll",
        is_final=is_final,
        row_count=len(rows),
        checksum=checksum,
        payload=payload,
        captured_by=actor,
    )
    if kind == "attendance":
        period.attendance.update(snapshot=snap)
    audit(actor, "snapshot.captured", snap, kind=kind, version=version, checksum=checksum)
    return snap


# --------------------------------------------------------------------- inputs

INPUT_TYPE_COMPONENT = {
    "bonus": "earning",
    "incentive": "earning",
    "overtime": "earning",
    "shift_allowance": "earning",
    "arrears": "earning",
    "one_time_earning": "earning",
    "reimbursement": "earning",
    "adhoc_deduction": "deduction",
    "recovery": "deduction",
    "loan_recovery": "deduction",
    "tds": "deduction",
}


def _validate_input(period, data):
    errors = {}
    component = data.get("component")
    kind = data.get("input_type")
    if kind not in INPUT_TYPE_COMPONENT:
        errors["input_type"] = ["Choose an input type."]
    elif component is not None and component.component_type != INPUT_TYPE_COMPONENT[kind]:
        errors["component"] = [
            f"A {kind.replace('_', ' ')} must use an {INPUT_TYPE_COMPONENT[kind]} component."
        ]
    if component is not None and component.status != "active":
        errors["component"] = [f"{component.code} is not active."]
    amount, units = data.get("amount"), data.get("units")
    if amount in (None, "") and units in (None, ""):
        errors["amount"] = ["Enter an amount, or units for a units × rate component."]
    if amount not in (None, "") and Decimal(str(amount)) < 0:
        errors["amount"] = ["Amount cannot be negative; use a deduction type instead."]
    if not (data.get("reason") or "").strip():
        errors["reason"] = ["A reason is required for every manual input."]
    employee = data.get("employee")
    if employee is not None and not population(period).filter(pk=employee.pk).exists():
        errors["employee"] = ["This employee is not in this pay group's payroll for the period."]
    if errors:
        raise invalid("The payroll input could not be saved.", errors)


def duplicates_of(record):
    return (
        m.PayrollInput.objects.filter(
            period=record.period,
            employee=record.employee,
            component=record.component,
            input_type=record.input_type,
            amount=record.amount,
            units=record.units,
        )
        .exclude(pk=record.pk)
        .exclude(status__in=("rejected", "superseded"))
    )


@transaction.atomic
def add_input(period, data, actor):
    ensure_unlocked(period)
    _validate_input(period, data)
    fields = {
        k: v
        for k, v in data.items()
        if k
        in {
            "employee",
            "input_type",
            "component",
            "amount",
            "units",
            "rate",
            "reason",
            "remarks",
            "reference_period",
            "expense_date",
            "source_module",
            "source_record_id",
            "source_batch_id",
            "source_row_key",
        }
    }
    try:
        with transaction.atomic():
            record = m.PayrollInput.objects.create(
                period=period, status="pending", created_by=actor, updated_by=actor, **fields
            )
    except IntegrityError:
        raise conflict(
            f"Row {fields.get('source_row_key')} of batch "
            f"{fields.get('source_batch_id')} was already imported.",
            code="PAY_DUPLICATE_INPUT",
        )
    touch(period)
    audit(actor, "input.created", record, changes={"new": snapshot(record)})
    return record


@transaction.atomic
def import_inputs_csv(period, text, actor, batch_id):
    """Columns: row_key, employee_code, input_type, component_code, amount,
    units, rate, reason. Re-importing a row_key of the same batch is rejected."""
    ensure_unlocked(period)
    if not batch_id:
        raise invalid(
            "A batch id is required so duplicate rows can be detected.", {"batch_id": ["Required."]}
        )
    reader = csv.DictReader(io.StringIO(text))
    employees = {e.employee_code: e for e in population(period)}
    components = {c.code: c for c in m.SalaryComponent.objects.filter(status="active")}
    created, errors = 0, []
    for number, row in enumerate(reader, start=2):
        try:
            employee = employees.get((row.get("employee_code") or "").strip())
            component = components.get((row.get("component_code") or "").strip().upper())
            if employee is None or component is None:
                raise ValueError("Unknown employee_code or component_code.")
            add_input(
                period,
                {
                    "employee": employee,
                    "component": component,
                    "input_type": (row.get("input_type") or "").strip(),
                    "amount": row.get("amount") or None,
                    "units": row.get("units") or None,
                    "rate": row.get("rate") or None,
                    "reason": row.get("reason") or "Imported",
                    "source_module": "import",
                    "source_batch_id": batch_id,
                    "source_row_key": (row.get("row_key") or str(number)).strip(),
                },
                actor,
            )
            created += 1
        except Exception as exc:  # noqa: BLE001 - report every bad row
            errors.append({"row": number, "error": getattr(exc, "message", str(exc))})
    audit(actor, "input.imported", period, batch_id=batch_id, rows=created, errors=len(errors))
    return {"imported": created, "errors": errors}


@transaction.atomic
def update_input(record, data, actor):
    ensure_unlocked(record.period)
    if record.status not in ("draft", "pending", "rejected"):
        raise conflict("Only a pending or rejected input can be edited.", code="PAY_INVALID_STATE")
    before = snapshot(record)
    for field in (
        "amount",
        "units",
        "rate",
        "reason",
        "remarks",
        "component",
        "input_type",
        "reference_period",
        "expense_date",
    ):
        if field in data:
            setattr(record, field, data[field])
    _validate_input(
        record.period,
        {**snapshot(record), "component": record.component, "employee": record.employee, **data},
    )
    record.status = "pending"
    record.version += 1
    record.updated_by = actor
    record.save()
    audit(actor, "input.updated", record, changes={"before": before, "after": snapshot(record)})
    return record


@transaction.atomic
def decide_input(record, decision, actor, comment=""):
    ensure_unlocked(record.period)
    if decision not in ("approve", "reject"):
        raise invalid("Decision must be approve or reject.")
    if record.status not in ("pending", "draft", "rejected", "approved"):
        raise conflict("This input can no longer be changed.", code="PAY_INVALID_STATE")
    if decision == "reject" and not comment.strip():
        raise invalid("A comment is required to reject an input.", {"comment": ["Required."]})
    record.status = "approved" if decision == "approve" else "rejected"
    record.approved_by = actor
    record.approved_at = timezone.now()
    record.decision_comment = comment
    record.version += 1
    record.save()
    audit(actor, f"input.{record.status}", record, reason=comment)
    return record


@transaction.atomic
def delete_input(record, actor):
    ensure_unlocked(record.period)
    if record.status in ("included",):
        raise conflict(
            "An input included in a finalized payroll cannot be deleted.", code="PAY_INVALID_STATE"
        )
    audit(actor, "input.deleted", record, changes={"old": snapshot(record)})
    record.delete()


@transaction.atomic
def generate_ot_inputs(period, component, actor):
    """PAY-008: turn approved OT hours from the finalized attendance/timesheet
    summary into overtime inputs (units × component rate)."""
    ensure_unlocked(period)
    if component.calculation_type not in ("units_rate", "formula"):
        raise invalid("Choose an overtime component calculated as units × rate or a formula.")
    count = 0
    for row in period.attendance.filter(ot_hours__gt=0, status="final"):
        key = f"OT-{row.employee_id}"
        if m.PayrollInput.objects.filter(
            period=period, source_batch_id="attendance-ot", source_row_key=key
        ).exists():
            continue
        record = m.PayrollInput.objects.create(
            period=period,
            employee=row.employee,
            input_type="overtime",
            component=component,
            units=row.ot_hours,
            reason=f"Approved OT {row.ot_hours} h from finalized timesheets",
            source_module="timesheet",
            source_batch_id="attendance-ot",
            source_row_key=key,
            status="approved",
            approved_by=actor,
            approved_at=timezone.now(),
            created_by=actor,
            updated_by=actor,
        )
        audit(actor, "input.created", record, source="timesheet")
        count += 1
    return count


@transaction.atomic
def generate_loan_recoveries(period, actor):
    """Post the monthly instalment of each active loan/advance as an approved
    recovery input (idempotent per loan and period)."""
    ensure_unlocked(period)
    count = 0
    ids = population(period).values_list("pk", flat=True)
    for loan in m.EmployeeDeduction.objects.filter(
        employee_id__in=ids,
        is_active=True,
        installments_remaining__gt=0,
        start_date__lte=period.end_date,
        component__isnull=False,
    ):
        key = f"LOAN-{loan.pk}"
        if m.PayrollInput.objects.filter(
            period=period, source_batch_id="loan-schedule", source_row_key=key
        ).exists():
            continue
        m.PayrollInput.objects.create(
            period=period,
            employee=loan.employee,
            input_type="loan_recovery",
            component=loan.component,
            amount=loan.installment_amount,
            reason=f"{loan.name} instalment",
            source_module="loan_schedule",
            source_record_id=str(loan.pk),
            source_batch_id="loan-schedule",
            source_row_key=key,
            status="approved",
            approved_by=actor,
            approved_at=timezone.now(),
            created_by=actor,
            updated_by=actor,
        )
        count += 1
    audit(actor, "input.loan_recoveries_generated", period, rows=count)
    return count


# --------------------------------------------------------- joiners and exits


def joiners_and_exits(period):
    joiners, exits = [], []
    actions = {(a.employee_id, a.kind): a for a in period.employee_actions.all()}
    for employee in population(period):
        profile = people.profile_for(employee, period.end_date)
        start = max(
            filter(None, [employee.date_of_joining, getattr(profile, "payroll_start_date", None)]),
            default=None,
        )
        if start and period.start_date < start <= period.end_date:
            joiners.append((employee, start, actions.get((employee.pk, "joiner"))))
        end = min(
            filter(None, [employee.date_of_exit, getattr(profile, "payroll_end_date", None)]),
            default=None,
        )
        if end and period.start_date <= end < period.end_date:
            exits.append((employee, end, actions.get((employee.pk, "exit"))))
    return joiners, exits


@transaction.atomic
def set_employee_action(period, employee, kind, decision, reason, actor):
    ensure_unlocked(period)
    if kind == "hold" and decision == "hold" and not (reason or "").strip():
        raise invalid("A reason is required to hold salary.", {"reason": ["Required."]})
    action, _ = m.PayrollEmployeeAction.objects.update_or_create(
        period=period,
        employee=employee,
        kind=kind,
        defaults={
            "decision": decision,
            "reason": reason or "",
            "updated_by": actor,
            "created_by": actor,
        },
    )
    touch(period)
    audit(actor, f"employee_action.{kind}.{decision}", action, reason=reason)
    return action


def is_on_hold(period, employee_id):
    return m.PayrollEmployeeAction.objects.filter(
        period=period, employee_id=employee_id, decision__in=("hold", "ff_pending")
    ).exists()


# ---------------------------------------------------------------- overrides


@transaction.atomic
def add_override(period, employee, component, amount, reason, actor):
    ensure_unlocked(period)
    if not (reason or "").strip():
        raise invalid("An override needs a reason.", {"reason": ["Required."]})
    period.overrides.filter(employee=employee, component=component, is_active=True).update(
        is_active=False
    )
    override = m.PayrollOverride.objects.create(
        period=period,
        employee=employee,
        component=component,
        override_amount=amount,
        reason=reason,
        created_by=actor,
    )
    audit(actor, "override.created", override, changes={"new": snapshot(override)}, reason=reason)
    return override


@transaction.atomic
def remove_override(override, actor, reason=""):
    ensure_unlocked(override.period)
    override.is_active = False
    override.save(update_fields=["is_active"])
    audit(actor, "override.removed", override, reason=reason)


# ---------------------------------------------------------------- readiness


def readiness(period):
    """GET /periods/{id}/readiness: source/input readiness before calculating."""
    employees = list(population(period))
    ids = [e.pk for e in employees]
    attendance = {a.employee_id: a for a in period.attendance.all()}
    missing_attendance = [e for e in employees if e.pk not in attendance]
    pending_attendance = [a for a in attendance.values() if a.status != "final"]
    pending_leave = [a for a in attendance.values() if a.pending_leave_requests]
    no_comp = [e for e in employees if people.current_compensation(e, period.end_date) is None]
    missing_data = []
    for e in employees:
        missing = people.missing_profile_fields(e)
        if missing:
            missing_data.append((e, missing))
    inputs = period.inputs.all()
    pending_inputs = inputs.filter(status__in=("pending", "draft")).count()
    open_revisions = m.CompensationRevision.objects.filter(
        employee_id__in=ids, status="pending_approval", effective_from__lte=period.end_date
    ).count()
    unreviewed = m.StatutoryRule.objects.filter(status="active", is_reviewed=False).count()
    unassigned = Employee.objects.filter(status="active", payroll_profiles__isnull=True).count()
    policy = period.pay_group.attendance_policy
    checks = [
        _check(
            "no_compensation",
            "blocking",
            len(no_comp),
            "employee(s) without an approved salary structure",
            [employee_card(e) for e in no_comp],
        ),
        _check(
            "missing_attendance",
            "blocking" if policy == "block" else "warning",
            len(missing_attendance),
            "employee(s) with missing attendance",
            [employee_card(e) for e in missing_attendance],
        ),
        _check(
            "pending_attendance",
            "blocking" if policy == "block" else "warning",
            len(pending_attendance),
            "attendance record(s) not finalized",
            [employee_card(a.employee) for a in pending_attendance],
        ),
        _check(
            "pending_leave",
            "warning",
            len(pending_leave),
            "employee(s) with pending leave approvals",
            [employee_card(a.employee) for a in pending_leave],
        ),
        _check(
            "missing_payroll_data",
            "warning",
            len(missing_data),
            "employee(s) with missing bank / statutory / profile data",
            [{**employee_card(e), "missing": missing} for e, missing in missing_data],
        ),
        _check(
            "pending_inputs", "warning", pending_inputs, "payroll input(s) awaiting approval", []
        ),
        _check(
            "pending_revisions",
            "warning",
            open_revisions,
            "salary revision(s) awaiting approval",
            [],
        ),
        _check(
            "statutory_unreviewed",
            "warning",
            unreviewed,
            "statutory rule(s) not yet reviewed by payroll/compliance",
            [],
        ),
        _check(
            "no_profile",
            "info",
            unassigned,
            "active employee(s) with no payroll profile (not in any pay group)",
            [],
        ),
    ]
    return {
        "period_id": str(period.pk),
        "employee_count": len(employees),
        "ready_count": len(employees)
        - len({e.pk for e in no_comp} | {e.pk for e in missing_attendance}),
        "checks": checks,
        "blocking": sum(c["count"] for c in checks if c["severity"] == "blocking"),
        "warnings": sum(c["count"] for c in checks if c["severity"] == "warning"),
    }


def _check(code, severity, count, label, items):
    return {
        "code": code,
        "severity": severity if count else "ok",
        "count": count,
        "label": label,
        "items": items[:200],
    }
