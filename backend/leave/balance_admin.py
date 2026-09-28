"""PLAN.md Step 7 (extended) — the org-admin view of every employee's leave
balances (Settings > Leave Settings > Leave Balances), gated by
`attendance.settings.manage` (the same code that already gates Shifts/Policy
Settings/Leave Types write — PLAN.md §1.6/§6). Distinct from
`LeaveBalanceViewSet` in `views.py`: that one is self-service ("my own
balances", `leave.read`, snake_case to match its existing wire contract);
this is HR-wide read + correction across every employee, with no existing
wire contract to preserve (`LeaveBalancesPanel.tsx` is still local sample
state) — so, like Shift/PolicySettings (Step 6), it relies on the project's
default `djangorestframework_camel_case` renderer/parser instead of forcing
snake_case. Concretely: this file's own Python dict keys are plain snake_case
(`leave_type_id`, `carry_forward`, ...) and the renderer/parser translate to
and from `leaveTypeId`/`carryForward` at the HTTP boundary — writing camelCase
keys directly here would just get parsed as `None` on the way in and
double-camelCased (or left alone, inconsistently) on the way out.

Doesn't map onto one Django model (it aggregates Employee x LeaveType x
LeaveBalance for the current financial year), so this is a hand-rolled
{success, data} dict response, not a ModelSerializer — the same pattern
`attendance/views.py`'s `_summarize()` and `day_view.py` already use for a
cross-model aggregate."""

from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from audit.service import write_audit
from core.enums import EmployeeStatus
from core.permissions import HasPermissionCode
from employees.models import Employee

from .balances import get_or_seed_balance
from .models import LeaveType, LeaveTypeStatus

MANAGE = "attendance.settings.manage"


def _d1(value) -> str:
    """A DecimalField(decimal_places=1) value, always formatted to one decimal
    place — a value fresh off a `get_or_create()` default (not re-fetched from
    Postgres) can otherwise stringify as "0" instead of "0.0", since Python's
    `Decimal` doesn't carry the column's scale the way a value round-tripped
    through the DB does."""
    return str(Decimal(value).quantize(Decimal("0.1")))


def _employee_display_name(employee) -> str:
    return employee.user.get_full_name() or employee.user.get_username()


def _employee_row(employee, leave_types, financial_year: str) -> dict:
    balances = []
    for leave_type in leave_types:
        balance, _created = get_or_seed_balance(employee, leave_type, financial_year)
        balances.append(
            {
                "leave_type_id": str(leave_type.pk),
                "used": _d1(balance.used),
                "allocated": _d1(balance.allocated),
                "carry_forward": _d1(balance.carry_forward),
                "entitled": _d1(balance.entitled),
                "available": _d1(balance.available),
            }
        )
    return {
        "id": str(employee.pk),
        "name": _employee_display_name(employee),
        "employee_code": employee.employee_code,
        "business_unit": employee.business_unit.name if employee.business_unit_id else None,
        "department": employee.department.name if employee.department_id else None,
        "location": employee.location.name if employee.location_id else None,
        "balances": balances,
    }


class LeaveBalanceAdminViewSet(viewsets.ViewSet):
    """`/leave/balances/admin` — GET lists every active employee's balances
    for the current financial year (lazily seeded via the same
    `get_or_seed_balance` the self-service endpoint and the yearly rollover
    command use); PATCH `/leave/balances/admin/{employee_id}` corrects one
    employee's `used` days across one or more leave types in a single call,
    matching `LeaveBalancesPanel.tsx`'s one-employee-at-a-time edit modal
    (which submits every leave type's field together, not one row at a time)."""

    permission_classes = [HasPermissionCode]
    required_permission = MANAGE

    def list(self, request):
        financial_year = str(timezone.localdate().year)
        leave_types = list(LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE))
        employees = (
            Employee.objects.filter(status=EmployeeStatus.ACTIVE)
            .select_related("user", "department", "location", "business_unit")
            .order_by("employee_code")
        )
        data = {
            "leave_types": [
                {
                    "id": str(leave_type.pk),
                    "name": leave_type.name,
                    "annual_allocation": _d1(leave_type.annual_allocation),
                }
                for leave_type in leave_types
            ],
            "employees": [_employee_row(e, leave_types, financial_year) for e in employees],
        }
        return Response({"success": True, "data": data})

    def partial_update(self, request, pk=None):
        financial_year = str(timezone.localdate().year)
        employee = (
            Employee.objects.filter(pk=pk, status=EmployeeStatus.ACTIVE)
            .select_related("user", "department", "location", "business_unit")
            .first()
        )
        if employee is None:
            raise NotFound("Employee not found.")

        leave_types_by_id = {
            str(lt.pk): lt for lt in LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE)
        }
        updates = request.data.get("balances")
        if not isinstance(updates, list) or not updates:
            raise ValidationError({"balances": "Must be a non-empty list."})

        for item in updates:
            leave_type_id = str(item.get("leave_type_id"))
            leave_type = leave_types_by_id.get(leave_type_id)
            if leave_type is None:
                raise ValidationError({"balances": f"Unknown leave type '{leave_type_id}'."})
            try:
                used = Decimal(str(item.get("used")))
            except (InvalidOperation, TypeError):
                raise ValidationError(
                    {"balances": f"Invalid 'used' value for leave type '{leave_type_id}'."}
                )
            if used < 0:
                raise ValidationError({"balances": "'used' cannot be negative."})

            balance, _created = get_or_seed_balance(
                employee, leave_type, financial_year, actor=request.user
            )
            if used > balance.entitled:
                raise ValidationError(
                    {
                        "balances": (
                            f"'used' ({used}) cannot exceed entitled "
                            f"({balance.entitled}) for '{leave_type.name}'."
                        )
                    }
                )
            if balance.used != used:
                before = str(balance.used)
                balance.used = used
                balance.save(update_fields=["used", "updated_at"])
                write_audit(
                    request.user,
                    "LeaveBalance.admin_adjusted",
                    "LeaveBalance",
                    balance.pk,
                    {"leave_type": leave_type.name, "before": before, "after": str(used)},
                )

        leave_types = list(leave_types_by_id.values())
        return Response(
            {"success": True, "data": _employee_row(employee, leave_types, financial_year)}
        )
