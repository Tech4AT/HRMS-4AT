"""PLAN.md Step 4.

LeaveTypeViewSet: admin CRUD, gated by `attendance.settings.manage`, but
readable by any authenticated employee (matches the frontend's `/leave` page,
which lists types for everyone submitting a request — no `hasPermission` call
there, PLAN.md §3.2). `get_permissions()` relaxes read; `permission_classes`
stays `[HasPermissionCode]` at the class level so core.checks still verifies
`required_permission` is registered.

LeaveBalanceViewSet: self-service read of the caller's own balances, lazily
seeding a row per active LeaveType for the current financial year on first
reference via `balances.get_or_seed_balance()` (PLAN.md Step 7) — the same
seeding the scheduled `roll_leave_balances` command performs, so whichever
happens first (an employee's own read, or the yearly job) does the real work
and the other just finds the row already there. Proration for a mid-year
joiner is still out of scope (see `balances.py`).

LeaveRequestViewSet: create validates through conflicts.py (overlap, holiday/
week-off spanning rules, balance sufficiency) before ever raising a request.
`requires_approval=True` raises through the approvals engine exactly like
AttendanceRequestViewSet; `requires_approval=False` bypasses the engine
entirely and auto-approves immediately, by direct analogy to Penalisation's
existing exemption (no human decision being made, so nothing for the engine to
route) — confirmed with the project owner rather than assumed.

HolidayViewSet: `/leave/holidays` — the signed-in employee's own holidays,
merged across their calendars, in the frontend's separate `Holiday` type, for the
pre-existing `/calendar` company page and Home's HolidaysWidget (PLAN.md §11 —
their own UX is owned elsewhere, but this module's `/leave` prefix has to keep
serving them from the same underlying data, not a second holiday list)."""

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Count
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
from core.scope import resolve_employee_scope, user_has_permission
from employees.models import Employee
from org_calendar.resolution import resolve_calendar_range

from . import comp_off, conflicts
from .balances import get_or_seed_balance
from .models import (
    CompOffRequest,
    HalfDayOption,
    LeaveBalance,
    LeaveRequest,
    LeaveRequestStatus,
    LeaveType,
    LeaveTypeStatus,
)
from .serializers import (
    CompOffRequestSerializer,
    LeaveBalanceSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)


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
    """Leave types. The rule for history: delete unused configuration,
    deactivate used configuration.

    - DELETE removes a type only when nothing references it (no balances, no
      requests); otherwise 409 with the counts, and the caller should
      deactivate instead.
    - Setting `status` to `inactive` retires a type: it can no longer be picked
      for new requests, while its balances, requests and history stay intact.
      Setting it back to `active` reactivates it.
    - POST /leave/types/<id>/purge is the deliberate exception that erases the
      type together with every balance and request that uses it. It needs the
      type's exact name in the body, and is audited with the counts."""

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

    def _can_manage(self):
        return user_has_permission(self.request.user, self.required_permission)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in ("list", "retrieve") and self._can_manage():
            # distinct: two joins would otherwise multiply each other's rows.
            queryset = queryset.annotate(
                balance_count_annotation=Count("balances", distinct=True),
                request_count_annotation=Count("requests", distinct=True),
            )
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = self.request.user if self.request else None
        context["show_usage"] = bool(user and user.is_authenticated and self._can_manage())
        return context

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        if request.data.get("status") == LeaveTypeStatus.INACTIVE:
            self._refuse_if_policy_uses(self.get_object())
        return super().update(request, *args, **kwargs)

    @staticmethod
    def _policy_uses(instance) -> list[str]:
        """Which attendance-policy settings still point at this type."""
        from attendance.models import PolicySettings

        policy = PolicySettings.objects.first()
        if policy is None:
            return []
        uses = []
        if policy.penalty_leave_type_id == instance.pk:
            uses.append("the No Attendance penalty")
        return uses

    def _refuse_if_policy_uses(self, instance):
        uses = self._policy_uses(instance)
        if uses:
            # A deactivated type drops out of everyone's balance list, so days
            # the policy keeps crediting or debiting there would vanish from view.
            raise Conflict(
                f"'{instance.name}' can't be deactivated while it is used for "
                f"{' and '.join(uses)} in the attendance policy. Choose a different "
                "leave type there first."
            )

    def perform_destroy(self, instance):
        # Same pattern as employees/views.py's reference-table deletes: check
        # for blockers explicitly and raise a clear Conflict, rather than
        # letting a bare ProtectedError surface as an unhandled 500.
        balances = instance.balances.count()
        requests_count = instance.requests.count() + instance.comp_off_requests.count()
        if balances or requests_count:
            raise Conflict(
                f"'{instance.name}' is referenced by {balances} balance(s) and "
                f"{requests_count} request(s). Remove them first, or deactivate the "
                "type instead of deleting it."
            )
        super().perform_destroy(instance)

    @action(detail=True, methods=["post"], url_path="purge")
    def purge(self, request, pk=None):
        """Permanently erase a leave type AND every balance and request that
        uses it. Irreversible, so the exact type name must be sent back."""
        instance = self.get_object()
        if (request.data.get("confirm_name") or "") != instance.name:
            raise ValidationError(
                {
                    "confirm_name": f"Type the leave type's exact name, '{instance.name}', to confirm."
                }
            )
        with transaction.atomic():
            type_pk, name = instance.pk, instance.name
            requests_qs = instance.requests.all()
            comp_off_qs = instance.comp_off_requests.all()
            # Approval rows raised for these leaves would otherwise linger in
            # approvers' queues pointing at leave that no longer exists.
            approval_ids = [
                pk
                for qs in (requests_qs, comp_off_qs)
                for pk in qs.exclude(approval_request__isnull=True).values_list(
                    "approval_request_id", flat=True
                )
            ]
            counts = {
                "balances": instance.balances.count(),
                "requests": requests_qs.count() + comp_off_qs.count(),
                "approvals": len(approval_ids),
            }
            requests_qs.delete()
            comp_off_qs.delete()
            instance.balances.all().delete()
            if approval_ids:
                from approvals.models import Request as ApprovalRequest

                ApprovalRequest.objects.filter(pk__in=approval_ids).delete()
            # PolicySettings and penalisation records only SET_NULL back to the
            # type/balance, so they survive with the link cleared.
            instance.delete()
            self._write_audit("purged", type_pk, {"name": name, **counts})
        return Response({"success": True, "data": {"id": str(type_pk), **counts}})


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
            balance, _created = get_or_seed_balance(
                employee, leave_type, financial_year, actor=request.user
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
        try:
            leave_type_pk = int(leave_type_id)
        except (TypeError, ValueError) as exc:
            # A raw `pk=` filter with a non-numeric string reaches Postgres
            # before Django ever validates it, and 500s there instead of
            # 400ing cleanly — found during a comprehensive audit.
            raise ValidationError(
                {"leave_type_id": "Must reference an active leave type."}
            ) from exc
        leave_type = LeaveType.objects.filter(
            pk=leave_type_pk, status=LeaveTypeStatus.ACTIVE
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

        # PLAN.md Step 12's concurrency check: two simultaneous requests
        # against the same balance (read, validate, increment, save with no
        # locking) could both read the same `pending`/`used` and both pass
        # `validate_sufficient_balance`, then the second `save()` silently
        # overwrites the first's increment — a lost update that can also let
        # an employee over-draw their balance via a race, not just a
        # bookkeeping glitch. `select_for_update()` inside one transaction
        # serializes concurrent requests against the same row: the second
        # request blocks until the first commits, then sees its effect.
        with transaction.atomic():
            balance, _created = LeaveBalance.objects.get_or_create(
                employee=employee,
                leave_type=leave_type,
                financial_year=financial_year,
                defaults={"allocated": leave_type.annual_allocation},
            )
            balance = LeaveBalance.objects.select_for_update().get(pk=balance.pk)
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
                request.user,
                "LeaveRequest.created",
                "LeaveRequest",
                row.pk,
                {"after": leave_type.name},
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


class CompOffRequestViewSet(
    FrontendEnvelopeMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """/leave/comp-off — request compensatory days for off days worked
    (leave/comp_off.py). Same RBAC and lifecycle as LeaveRequestViewSet: the
    caller sees only their own requests, every request is routed to their
    manager through the approvals engine, and approving it credits the balance
    (handlers.py)."""

    serializer_class = CompOffRequestSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "leave.read"
    write_permission = "leave.write"
    action_permissions = {
        "cancel": "leave.write",
        "eligible_days": "leave.write",
        "approvals_pending": "leave.approve",
        "approvals_history": "leave.approve",
    }
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        base = CompOffRequest.objects.select_related(
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
        today = timezone.localdate()
        dates = comp_off.validate_comp_off_request(
            employee, request.data.get("worked_dates"), today
        )
        reason = (request.data.get("reason") or "").strip()

        with transaction.atomic():
            # Locking the employee row serialises two simultaneous submissions so
            # they cannot both claim the same date.
            Employee.objects.select_for_update().get(pk=employee.pk)
            dates = comp_off.validate_comp_off_request(
                employee, [d.isoformat() for d in dates], today
            )
            row = CompOffRequest.objects.create(
                employee=employee,
                worked_dates=[d.isoformat() for d in dates],
                days=Decimal(len(dates)),
                reason=reason,
            )
            write_audit(
                request.user,
                "CompOffRequest.created",
                "CompOffRequest",
                row.pk,
                {"dates": row.worked_dates},
            )
            approval = approvals.create_request(
                request.user,
                "comp_off",
                {
                    "comp_off_request_id": row.pk,
                    "worked_dates": row.worked_dates,
                    "days": str(row.days),
                    "reason": reason,
                },
            )
            row.approval_request = approval
            row.save(update_fields=["approval_request"])

        return Response({"success": True, "data": CompOffRequestSerializer(row).data}, status=201)

    @action(detail=False, methods=["get"], url_path="eligible-days")
    def eligible_days(self, request):
        """Off days the caller could still claim. Which balance the credit goes to
        is chosen by the approver, not here."""
        employee = _employee_or_403(request)
        return Response(
            {
                "success": True,
                "data": {
                    "lookback_days": comp_off.LOOKBACK_DAYS,
                    "days": comp_off.eligible_days(employee, timezone.localdate()),
                },
            }
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.status != LeaveRequestStatus.SUBMITTED:
            raise ValidationError("Only a pending request can be cancelled through this action.")
        if instance.approval_request is None:
            raise ValidationError("This request has no linked approval to withdraw.")
        approvals.withdraw(instance.approval_request, request.user)
        instance.refresh_from_db()
        write_audit(request.user, "CompOffRequest.cancelled", "CompOffRequest", instance.pk)
        return Response({"success": True, "data": CompOffRequestSerializer(instance).data})

    @action(detail=False, methods=["get"], url_path="approvals/pending")
    def approvals_pending(self, request):
        serializer = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True)
        return Response({"success": True, "data": serializer.data})

    @action(detail=False, methods=["get"], url_path="approvals/history")
    def approvals_history(self, request):
        serializer = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True)
        return Response({"success": True, "data": serializer.data})


class HolidayViewSet(FrontendEnvelopeMixin, viewsets.ViewSet):
    """/leave/holidays?year= — the signed-in employee's own holidays for the
    year, merged across every calendar that covers them (see
    org_calendar/resolution.py), in the `Holiday` shape the pre-existing
    `/calendar` page and HolidaysWidget expect. `is_optional`/`is_special`
    come from the holiday's flags. Someone covered by no calendar (or with no
    employee record) gets an empty list. Mixes in FrontendEnvelopeMixin for its
    plain-JSON renderer/parser only, same reasoning as LeaveBalanceViewSet
    above."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        year_param = request.query_params.get("year")
        if year_param:
            try:
                year = int(year_param)
            except ValueError as exc:
                raise ValidationError({"year": "Must be a whole number."}) from exc
        else:
            year = timezone.localdate().year
        employee = getattr(request.user, "employee", None)
        data = []
        if employee is not None:
            days = resolve_calendar_range(employee, date(year, 1, 1), date(year, 12, 31))
            for day, facts in days.items():
                for holiday in [*facts.holidays, *facts.optional_holidays]:
                    data.append(
                        {
                            "id": f"{day.isoformat()}:{holiday.name}",
                            "name": holiday.name,
                            "holiday_date": day.isoformat(),
                            "is_optional": holiday.optional,
                            "is_special": holiday.special,
                            "description": holiday.description,
                        }
                    )
        return Response({"success": True, "data": data})


def _parse_date_or_400(value, field_name):
    parsed = parse_date(value) if value else None
    if parsed is None:
        raise ValidationError({field_name: "Must be a valid YYYY-MM-DD date."})
    return parsed
