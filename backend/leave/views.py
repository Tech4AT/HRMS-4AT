"""PLAN.md Step 4.

LeaveTypeViewSet: admin CRUD, gated by `attendance.settings.manage`, but
readable by any authenticated employee (matches the frontend's `/leave` page,
which lists types for everyone submitting a request — no `hasPermission` call
there, PLAN.md §3.2). `get_permissions()` relaxes read; `permission_classes`
stays `[HasPermissionCode]` at the class level so core.checks still verifies
`required_permission` is registered.

LeaveBalanceViewSet: self-service read of the caller's own balances, lazily
creating a row per active LeaveType for the current financial year on first
reference (PLAN.md Step 7 owns real accrual/proration; this just makes the
feature work end-to-end today).

LeaveRequestViewSet: create validates through conflicts.py (overlap, holiday/
week-off spanning rules, balance sufficiency) before ever raising a request.
`requires_approval=True` raises through the approvals engine exactly like
AttendanceRequestViewSet; `requires_approval=False` bypasses the engine
entirely and auto-approves immediately, by direct analogy to Penalisation's
existing exemption (no human decision being made, so nothing for the engine to
route) — confirmed with the project owner rather than assumed.

HolidayViewSet: `/leave/holidays` — reshapes org_calendar's holiday
CalendarEntry rows into the frontend's separate `Holiday` type, for the
pre-existing `/calendar` company page and Home's HolidaysWidget (PLAN.md §11 —
their own UX is owned elsewhere, but this module's `/leave` prefix has to keep
serving them from the same underlying data, not a second holiday list)."""

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from approvals import service as approvals
from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.exceptions import Conflict
from core.permissions import HasPermissionCode, ScopedEmployeePermission
from core.scope import resolve_employee_scope
from org_calendar.models import CalendarEntry, CalendarEntryType

from . import conflicts
from .models import (
    HalfDayOption,
    LeaveBalance,
    LeaveRequest,
    LeaveRequestStatus,
    LeaveType,
    LeaveTypeStatus,
)
from .serializers import LeaveBalanceSerializer, LeaveRequestSerializer, LeaveTypeSerializer


def _employee_or_403(request):
    employee = getattr(request.user, "employee", None)
    if employee is None:
        raise PermissionDenied("This account has no employee record.")
    return employee


class EnvelopeMixin(FrontendEnvelopeMixin):
    """Same shape as org_calendar's local EnvelopeMixin (core.api's own only
    covers list/retrieve) — kept local to this module for the same reason
    org_calendar's is: core.api is core, this isn't."""

    audit_entity_name: str = ""

    def _write_audit(self, verb, entity_id, diff=None):
        if not self.audit_entity_name:
            return
        write_audit(
            self.request.user,
            f"{self.audit_entity_name}.{verb}",
            self.audit_entity_name,
            entity_id,
            diff,
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        self._write_audit("created", serializer.instance.pk, {"after": serializer.data})
        return Response({"success": True, "data": serializer.data}, status=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = self.get_serializer(instance).data
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        self._write_audit(
            "updated", serializer.instance.pk, {"before": before, "after": serializer.data}
        )
        return Response({"success": True, "data": serializer.data})

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        pk = instance.pk
        self.perform_destroy(instance)
        self._write_audit("deleted", pk)
        return Response({"success": True, "data": None})


class LeaveTypeViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    permission_classes = [HasPermissionCode]
    required_permission = "attendance.settings.manage"
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    audit_entity_name = "LeaveType"
    http_method_names = ["get", "post", "put", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # Same pattern as employees/views.py's reference-table deletes: check
        # for blockers explicitly and raise a clear Conflict, rather than
        # letting a bare ProtectedError surface as an unhandled 500.
        balances, requests_count = instance.balances.count(), instance.requests.count()
        if balances or requests_count:
            raise Conflict(
                f"'{instance.name}' is referenced by {balances} balance(s) and "
                f"{requests_count} request(s). Remove them first, or deactivate the "
                "type instead of deleting it."
            )
        super().perform_destroy(instance)


class LeaveBalanceViewSet(FrontendEnvelopeMixin, viewsets.ViewSet):
    """/leave/balance — the caller's own balances only. No write endpoint here
    (PLAN.md Step 7). Mixes in FrontendEnvelopeMixin only for its plain-JSON
    renderer/parser (this class defines its own `list()`, so the mixin's
    list/retrieve are never reached) — without it, the project's default
    camelCase renderer would rewrite every snake_case key in the response."""

    permission_classes = [ScopedEmployeePermission]
    required_permission = "leave.read"

    def list(self, request):
        employee = _employee_or_403(request)
        financial_year = str(timezone.localdate().year)
        balances = []
        for leave_type in LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE):
            balance, _created = LeaveBalance.objects.get_or_create(
                employee=employee,
                leave_type=leave_type,
                financial_year=financial_year,
                defaults={"allocated": leave_type.annual_allocation},
            )
            balances.append(balance)
        return Response({"success": True, "data": LeaveBalanceSerializer(balances, many=True).data})


class LeaveRequestViewSet(
    FrontendEnvelopeMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = LeaveRequestSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "leave.read"
    write_permission = "leave.write"
    action_permissions = {
        "cancel": "leave.write",
        "approvals_pending": "leave.approve",
        "approvals_history": "leave.approve",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        base = LeaveRequest.objects.select_related(
            "employee__user",
            "leave_type",
            "approval_request",
            "approval_request__approver__employee__user",
            "approval_request__decided_by__employee__user",
        )
        if self.action in ("approvals_pending", "approvals_history"):
            employee = _employee_or_403(self.request)
            scope = resolve_employee_scope(self.request.user, "leave.approve")
            queryset = base.filter(employee_id__in=scope).exclude(employee=employee)
            if self.action == "approvals_pending":
                return queryset.filter(status=LeaveRequestStatus.SUBMITTED)
            return queryset.exclude(status=LeaveRequestStatus.SUBMITTED).order_by(
                "-decided_at", "-updated_at"
            )
        return base.filter(employee=_employee_or_403(self.request))

    def create(self, request, *args, **kwargs):
        employee = _employee_or_403(request)

        leave_type_id = request.data.get("leave_type_id")
        leave_type = LeaveType.objects.filter(
            pk=leave_type_id, status=LeaveTypeStatus.ACTIVE
        ).first()
        if leave_type is None:
            raise ValidationError({"leave_type_id": "Must reference an active leave type."})

        start_date = _parse_date_or_400(request.data.get("start_date"), "start_date")
        end_date_raw = request.data.get("end_date")
        end_date = _parse_date_or_400(end_date_raw, "end_date") if end_date_raw else start_date
        half_day_option = request.data.get("half_day_option") or HalfDayOption.FULL_DAY
        if half_day_option not in HalfDayOption.values:
            raise ValidationError({"half_day_option": "Invalid half-day option."})
        reason = (request.data.get("reason") or "").strip()

        duration_days = conflicts.validate_leave_request(
            employee, leave_type, start_date, end_date, half_day_option
        )
        financial_year = str(start_date.year)
        balance, _created = LeaveBalance.objects.get_or_create(
            employee=employee,
            leave_type=leave_type,
            financial_year=financial_year,
            defaults={"allocated": leave_type.annual_allocation},
        )
        conflicts.validate_sufficient_balance(balance, duration_days)

        row = LeaveRequest.objects.create(
            employee=employee,
            leave_type=leave_type,
            start_date=start_date,
            end_date=end_date,
            half_day_option=half_day_option,
            reason=reason,
            duration_days=duration_days,
            financial_year=financial_year,
        )
        write_audit(
            request.user, "LeaveRequest.created", "LeaveRequest", row.pk, {"after": leave_type.name}
        )

        if leave_type.requires_approval:
            balance.pending += duration_days
            balance.save(update_fields=["pending", "updated_at"])
            # Plug into the approvals engine (docs/LEAVE-ATTENDANCE-INTEGRATION.md):
            # raise a request routed to the caller's manager. The decision comes
            # back via request_decided (handlers.py), which applies the effect.
            approval = approvals.create_request(
                request.user,
                "leave",
                {
                    "leave_request_id": row.pk,
                    "leave_type": leave_type.name,
                    "reason": reason,
                    "start_date": str(start_date),
                    "end_date": str(end_date),
                    "duration_days": str(duration_days),
                },
            )
            row.approval_request = approval
            row.save(update_fields=["approval_request"])
        else:
            # No human decision is being made — nothing for the engine to
            # route (same reasoning as Penalisation's exemption, PLAN.md
            # Step 1.3). Approve and deduct immediately.
            row.status = LeaveRequestStatus.APPROVED
            row.decided_at = timezone.now()
            row.save(update_fields=["status", "decided_at", "updated_at"])
            balance.used += duration_days
            balance.save(update_fields=["used", "updated_at"])
            write_audit(
                request.user,
                "LeaveRequest.auto_approved",
                "LeaveRequest",
                row.pk,
                {"reason": "leave_type.requires_approval is False"},
            )

        return Response({"success": True, "data": LeaveRequestSerializer(row).data}, status=201)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.status != LeaveRequestStatus.SUBMITTED:
            raise ValidationError("Only a pending request can be cancelled through this action.")
        if instance.approval_request is None:
            raise ValidationError("This request has no linked approval to withdraw.")
        approvals.withdraw(instance.approval_request, request.user)
        instance.refresh_from_db()
        write_audit(request.user, "LeaveRequest.cancelled", "LeaveRequest", instance.pk)
        return Response({"success": True, "data": LeaveRequestSerializer(instance).data})

    @action(detail=False, methods=["get"], url_path="approvals/pending")
    def approvals_pending(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({"success": True, "data": serializer.data})

    @action(detail=False, methods=["get"], url_path="approvals/history")
    def approvals_history(self, request):
        """Decided (approved/rejected/cancelled) requests within the caller's
        approve-scope — the counterpart to approvals_pending, for the
        Approvals page's per-tab history list."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({"success": True, "data": serializer.data})


class HolidayViewSet(FrontendEnvelopeMixin, viewsets.ViewSet):
    """/leave/holidays?year= — reshapes org_calendar's holidays into the
    separate `Holiday` type the pre-existing `/calendar` page and
    HolidaysWidget already expect. `is_optional` has no equivalent on
    CalendarEntry (org_calendar has no such concept) — always False, a known,
    stated contract gap rather than a silently invented field. Mixes in
    FrontendEnvelopeMixin for its plain-JSON renderer/parser only, same
    reasoning as LeaveBalanceViewSet above."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        year_param = request.query_params.get("year")
        year = int(year_param) if year_param else timezone.localdate().year
        entries = CalendarEntry.objects.filter(
            type=CalendarEntryType.HOLIDAY, date__year=year
        ).order_by("date")
        data = [
            {
                "id": str(e.pk),
                "name": e.name,
                "holiday_date": e.date.isoformat(),
                "is_optional": False,
                "description": e.description,
            }
            for e in entries
        ]
        return Response({"success": True, "data": data})


def _parse_date_or_400(value, field_name):
    parsed = parse_date(value) if value else None
    if parsed is None:
        raise ValidationError({field_name: "Must be a valid YYYY-MM-DD date."})
    return parsed
