"""Shared helpers for payroll services: the PAY_* error contract (API
contract §10), audit writing, optimistic version checks and period locks."""

import datetime
import decimal
import uuid

from django.forms.models import model_to_dict
from rest_framework import status

from audit.service import write_audit


class PayrollError(Exception):
    """A business error with a stable code the UI can act on."""

    def __init__(
        self, code, message, http_status=status.HTTP_400_BAD_REQUEST, details=None, fields=None
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.details = details or {}
        self.fields = fields or {}


def invalid(message, fields=None, details=None):
    return PayrollError("PAY_INVALID_REQUEST", message, 400, details, fields)


def blocking(message, exceptions=None):
    return PayrollError("PAY_BLOCKING_VALIDATION", message, 422, {"exceptions": exceptions or []})


def conflict(message, code="PAY_VERSION_CONFLICT"):
    return PayrollError(code, message, 409)


def not_found(message="Not found."):
    return PayrollError("PAY_NOT_FOUND", message, 404)


def forbidden(message="You do not have permission to perform this action."):
    return PayrollError("PAY_FORBIDDEN", message, 403)


def jsonable(value):
    if isinstance(value, (decimal.Decimal, uuid.UUID)):
        return str(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def snapshot(instance, exclude=("created_at", "updated_at")):
    data = model_to_dict(instance)
    return jsonable({k: v for k, v in data.items() if k not in exclude})


def diff(old: dict, new: dict) -> dict:
    keys = sorted(set(old) | set(new))
    return {k: {"old": old.get(k), "new": new.get(k)} for k in keys if old.get(k) != new.get(k)}


def audit(actor, action, instance_or_type, entity_id=None, changes=None, reason="", **extra):
    """write_audit wrapper: entity type is the model name, `changes` the
    old/new values, `reason` the business justification (PAY-FR-025)."""
    if isinstance(instance_or_type, str):
        entity_type = instance_or_type
    else:
        entity_type = type(instance_or_type).__name__
        entity_id = entity_id or instance_or_type.pk
    payload = {}
    if changes:
        payload["changes"] = jsonable(changes)
    if reason:
        payload["reason"] = reason
    payload.update(jsonable(extra))
    return write_audit(actor, f"payroll.{action}", entity_type, entity_id, payload)


def check_version(instance, supplied):
    """Optimistic concurrency (API contract §11): the client must send the
    version it read; a mismatch means someone else changed the row."""
    if supplied in (None, ""):
        raise invalid(
            "`version` is required when updating this record.", {"version": ["Required."]}
        )
    if int(supplied) != instance.version:
        raise conflict(
            f"This record was changed by someone else (you have version {supplied}, "
            f"current is {instance.version}). Reload and try again."
        )


def ensure_unlocked(period):
    if period.is_locked:
        raise PayrollError(
            "PAY_PERIOD_LOCKED",
            f"Payroll for {period} is {period.get_status_display().lower()}. "
            "Reopen it (privileged, reason required) before making changes.",
            409,
        )


def month_bounds(year, month):
    start = datetime.date(year, month, 1)
    if month == 12:
        end = datetime.date(year, 12, 31)
    else:
        end = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
    return start, end


def employee_name(employee):
    user = getattr(employee, "user", None)
    if user is not None:
        full = f"{user.first_name} {user.last_name}".strip()
        if full:
            return full
        return user.get_username()
    return employee.employee_code


def employee_card(employee):
    return {
        "id": employee.pk,
        "employee_code": employee.employee_code,
        "name": employee_name(employee),
        "department": getattr(employee.department, "name", "") if employee.department_id else "",
        "designation": getattr(employee.designation, "name", "") if employee.designation_id else "",
        "location": getattr(employee.location, "name", "") if employee.location_id else "",
        "legal_entity": (
            getattr(employee.legal_entity, "name", "") if employee.legal_entity_id else ""
        ),
        "employment_type": employee.employment_type,
        "status": employee.status,
        "date_of_joining": (
            employee.date_of_joining.isoformat() if employee.date_of_joining else None
        ),
        "date_of_exit": employee.date_of_exit.isoformat() if employee.date_of_exit else None,
        "manager": employee_name(employee.manager) if employee.manager_id else "",
    }


def mask(value, visible=4):
    value = value or ""
    if len(value) <= visible:
        return value
    return "X" * (len(value) - visible) + value[-visible:]
