"""PLAN.md Step 3.

AttendanceViewSet: self-service check-in/out/break + the day-view reads
(today/history/summary). The day-view's independent overlay fields (holiday,
weekend, events, ...) come from day_facts.py; conflicts.py enforces which
combinations a WFH/Regularisation request is allowed to touch, at
creation time — see both modules' docstrings for the exact rules.

AttendanceRequestViewSet: WFH/regularisation requests. Raises through the
approvals engine (approvals.create_request) instead of exposing its own
approve/reject action — see handlers.py for the decision side. This mirrors
example_leave/views.py's perform_create() pattern exactly."""

import calendar
from datetime import date, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from approvals import service as approvals
from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.permissions import ScopedEmployeePermission
from core.scope import resolve_employee_scope

from . import conflicts
from .day_facts import get_day_facts_range
from .day_view import build_day_view
from .models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceRequestType,
    AttendanceSource,
    AttendanceStatus,
)
from .serializers import AttendanceRecordSerializer, AttendanceRequestSerializer


def _parse_date_or_400(value, field_name):
    parsed = parse_date(value) if value else None
    if parsed is None:
        raise ValidationError({field_name: "Must be a valid YYYY-MM-DD date."})
    return parsed


def _resolve_window(request):
    """lib/api/attendance.ts's AttendanceWindow: either `month=YYYY-MM`, or
    both `from=` and `to=` (YYYY-MM-DD)."""
    params = request.query_params
    month = params.get("month")
    if month:
        try:
            year, month_num = (int(part) for part in month.split("-", 1))
        except ValueError as exc:
            raise ValidationError({"month": "Must be YYYY-MM."}) from exc
        last_day = calendar.monthrange(year, month_num)[1]
        return date(year, month_num, 1), date(year, month_num, last_day)

    from_value, to_value = params.get("from"), params.get("to")
    if not from_value or not to_value:
        raise ValidationError("Provide either ?month=YYYY-MM or both ?from= and ?to=.")
    return _parse_date_or_400(from_value, "from"), _parse_date_or_400(to_value, "to")


def _date_span(start_date, end_date):
    day = start_date
    while day <= end_date:
        yield day
        day += timedelta(days=1)


def _summarize(start_date, end_date, views, today) -> dict:
    total_days = len(views)
    elapsed_days = sum(1 for v in views if date.fromisoformat(v["attendance_date"]) <= today)
    weekend_days = sum(1 for v in views if v["is_weekend"])
    holiday_days = sum(1 for v in views if v["is_holiday"])
    non_working_days = sum(1 for v in views if v["is_weekend"] or v["is_holiday"])
    present_statuses = {"present", "work_from_home", "half_day"}
    total_working_minutes = sum(v["working_minutes"] or 0 for v in views)
    return {
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "elapsed_days": elapsed_days,
        "total_days": total_days,
        "weekend_days": weekend_days,
        "holiday_days": holiday_days,
        "working_days": total_days - non_working_days,
        "present_days": sum(1 for v in views if v["status"] in present_statuses),
        "leave_days": sum(1 for v in views if v["status"] == "on_leave"),
        "absent_days": sum(1 for v in views if v["status"] == "absent"),
        "late_days": sum(1 for v in views if (v["late_minutes"] or 0) > 0),
        "early_leave_days": sum(1 for v in views if (v["early_leave_minutes"] or 0) > 0),
        "total_working_minutes": total_working_minutes,
        "total_working_hours": round(total_working_minutes / 60, 2),
        "overtime_minutes": sum(v["overtime_minutes"] or 0 for v in views),
    }


def _employee_or_403(request):
    employee = getattr(request.user, "employee", None)
    if employee is None:
        raise PermissionDenied("This account has no employee record.")
    return employee


class AttendanceViewSet(FrontendEnvelopeMixin, viewsets.ViewSet):
    """/attendance (history), /attendance/{today,summary,check-in,check-out,
    break-start,break-end}."""

    permission_classes = [ScopedEmployeePermission]
    required_permission = "attendance.read"
    write_permission = "attendance.write"
    action_permissions = {
        "today": "attendance.read",
        "summary": "attendance.read",
        "check_in": "attendance.write",
        "check_out": "attendance.write",
        "break_start": "attendance.write",
        "break_end": "attendance.write",
    }

    def list(self, request):
        """GET /attendance?from=&to= or ?month=YYYY-MM — the caller's own
        history for the window (lib/api/attendance.ts's getHistory)."""
        employee = _employee_or_403(request)
        start_date, end_date = _resolve_window(request)
        records = {
            r.attendance_date: r
            for r in AttendanceRecord.objects.filter(
                employee=employee, attendance_date__range=(start_date, end_date)
            ).prefetch_related("breaks")
        }
        today = timezone.localdate()
        # One batch of queries for the whole range (day_facts.py), not one
        # per day — looping the single-date lookup here was an N+1 pattern
        # that made a full month's history noticeably slow.
        facts_by_day = get_day_facts_range(start_date, end_date, employee=employee)
        views = [
            build_day_view(day, records.get(day), today=today, facts=facts_by_day[day])
            for day in _date_span(start_date, end_date)
        ]
        return Response({"success": True, "data": views})

    @action(detail=False, methods=["get"], url_path="today")
    def today(self, request):
        employee = _employee_or_403(request)
        today = timezone.localdate()
        record = (
            AttendanceRecord.objects.filter(employee=employee, attendance_date=today)
            .prefetch_related("breaks")
            .first()
        )
        return Response(
            {"success": True, "data": build_day_view(today, record, today=today, employee=employee)}
        )

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        employee = _employee_or_403(request)
        start_date, end_date = _resolve_window(request)
        records = {
            r.attendance_date: r
            for r in AttendanceRecord.objects.filter(
                employee=employee, attendance_date__range=(start_date, end_date)
            ).prefetch_related("breaks")
        }
        today = timezone.localdate()
        facts_by_day = get_day_facts_range(start_date, end_date, employee=employee)
        views = [
            build_day_view(day, records.get(day), today=today, facts=facts_by_day[day])
            for day in _date_span(start_date, end_date)
        ]
        return Response({"success": True, "data": _summarize(start_date, end_date, views, today)})

    @action(detail=False, methods=["post"], url_path="break-start")
    def break_start(self, request):
        employee = _employee_or_403(request)
        today = timezone.localdate()
        record = AttendanceRecord.objects.filter(employee=employee, attendance_date=today).first()
        if record is None or not record.clock_in_time or record.clock_out_time:
            raise ValidationError("You can only start a break while checked in.")
        if record.breaks.filter(end_time__isnull=True).exists():
            raise ValidationError("A break is already in progress.")
        record.breaks.create(start_time=timezone.now())
        write_audit(request.user, "AttendanceRecord.break_started", "AttendanceRecord", record.pk)
        return Response(
            {"success": True, "data": build_day_view(today, record, today=today, employee=employee)}
        )

    @action(detail=False, methods=["post"], url_path="break-end")
    def break_end(self, request):
        employee = _employee_or_403(request)
        today = timezone.localdate()
        record = AttendanceRecord.objects.filter(employee=employee, attendance_date=today).first()
        open_break = record.breaks.filter(end_time__isnull=True).first() if record else None
        if open_break is None:
            raise ValidationError("No break is currently in progress.")
        open_break.end_time = timezone.now()
        open_break.save(update_fields=["end_time"])
        write_audit(request.user, "AttendanceRecord.break_ended", "AttendanceRecord", record.pk)
        return Response(
            {"success": True, "data": build_day_view(today, record, today=today, employee=employee)}
        )

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request):
        employee = _employee_or_403(request)
        today = timezone.localdate()
        record, _created = AttendanceRecord.objects.get_or_create(
            employee=employee, attendance_date=today
        )
        if record.clock_in_time:
            raise ValidationError("Already checked in today.")
        record.clock_in_time = timezone.now()
        record.status = AttendanceStatus.PRESENT
        record.source = AttendanceSource.SELF
        notes = (request.data.get("notes") or "").strip()
        if notes:
            record.notes = notes
        record.save(update_fields=["clock_in_time", "status", "source", "notes", "updated_at"])
        write_audit(request.user, "AttendanceRecord.checked_in", "AttendanceRecord", record.pk)
        return Response({"success": True, "data": AttendanceRecordSerializer(record).data})

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        employee = _employee_or_403(request)
        today = timezone.localdate()
        record = AttendanceRecord.objects.filter(employee=employee, attendance_date=today).first()
        if record is None or not record.clock_in_time:
            raise ValidationError("You haven't checked in today.")
        if record.clock_out_time:
            raise ValidationError("Already checked out today.")
        record.clock_out_time = timezone.now()
        elapsed_minutes = int((record.clock_out_time - record.clock_in_time).total_seconds() // 60)
        break_minutes = sum(b.minutes for b in record.breaks.all())
        record.working_minutes = max(0, elapsed_minutes - break_minutes)
        notes = (request.data.get("notes") or "").strip()
        if notes:
            record.notes = f"{record.notes}\n{notes}".strip() if record.notes else notes
        record.save(update_fields=["clock_out_time", "working_minutes", "notes", "updated_at"])
        write_audit(request.user, "AttendanceRecord.checked_out", "AttendanceRecord", record.pk)
        return Response({"success": True, "data": AttendanceRecordSerializer(record).data})


class AttendanceRequestViewSet(
    FrontendEnvelopeMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """/attendance/requests — WFH/regularisation, self-service list/create/edit
    plus the scoped 'awaiting my decision' read used by the Dashboard's pending
    count. Deciding a request happens on the generic /api/requests endpoints,
    never here (PLAN.md Step 3/5)."""

    serializer_class = AttendanceRequestSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "attendance.read"
    write_permission = "attendance.write"
    action_permissions = {
        "cancel": "attendance.write",
        "approvals_pending": "attendance.approve",
        "approvals_history": "attendance.approve",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        base = AttendanceRequest.objects.select_related(
            "employee__user",
            "approval_request",
            "approval_request__approver__employee__user",
            "approval_request__decided_by__employee__user",
        )
        if self.action in ("approvals_pending", "approvals_history"):
            employee = _employee_or_403(self.request)
            scope = resolve_employee_scope(self.request.user, "attendance.approve")
            queryset = base.filter(employee_id__in=scope).exclude(employee=employee)
            if self.action == "approvals_pending":
                return queryset.filter(status=AttendanceRequestStatus.SUBMITTED)
            return queryset.exclude(status=AttendanceRequestStatus.SUBMITTED).order_by(
                "-decided_at", "-updated_at"
            )

        employee = _employee_or_403(self.request)
        queryset = base.filter(employee=employee)
        request_type = self.request.query_params.get("type")
        if request_type:
            queryset = queryset.filter(request_type=request_type)
        return queryset

    def create(self, request, *args, **kwargs):
        employee = _employee_or_403(request)
        request_type = request.data.get("request_type")
        if request_type not in AttendanceRequestType.values:
            raise ValidationError({"request_type": "Must be 'wfh' or 'regularisation'."})

        start_date = _parse_date_or_400(request.data.get("start_date"), "start_date")
        reason = (request.data.get("reason") or "").strip()

        if request_type == AttendanceRequestType.WFH:
            end_date_raw = request.data.get("end_date")
            if not end_date_raw:
                raise ValidationError({"end_date": "This field is required for a WFH request."})
            end_date = _parse_date_or_400(end_date_raw, "end_date")
            if end_date < start_date:
                raise ValidationError({"end_date": "Must not be before start_date."})
            conflicts.validate_wfh_request(employee, start_date, end_date)
        else:
            # "A regularisation request marks one whole day Present" (lib/api/
            # attendance.ts) — a single-day request, end_date == start_date.
            end_date = start_date
            conflicts.validate_regularisation_request(employee, start_date, end_date)

        row = AttendanceRequest.objects.create(
            employee=employee,
            request_type=request_type,
            start_date=start_date,
            end_date=end_date,
            reason=reason,
        )
        write_audit(
            request.user,
            "AttendanceRequest.created",
            "AttendanceRequest",
            row.pk,
            {"after": request_type},
        )

        # Plug into the approvals engine (docs/LEAVE-ATTENDANCE-INTEGRATION.md):
        # raise a request routed to the caller's manager. The decision comes
        # back via request_decided (handlers.py), which sets this row's status.
        approval_request_type = (
            "wfh" if request_type == AttendanceRequestType.WFH else "attendance_regularization"
        )
        approval = approvals.create_request(
            request.user,
            approval_request_type,
            {
                "attendance_request_id": row.pk,
                "reason": reason,
                "start_date": str(start_date),
                "end_date": str(end_date),
            },
        )
        row.approval_request = approval
        row.save(update_fields=["approval_request"])

        return Response(
            {"success": True, "data": AttendanceRequestSerializer(row).data},
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != AttendanceRequestStatus.SUBMITTED:
            raise ValidationError("Only a pending request can be edited.")
        before = AttendanceRequestSerializer(instance).data
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        write_audit(
            request.user,
            "AttendanceRequest.updated",
            "AttendanceRequest",
            instance.pk,
            {"before": before, "after": serializer.data},
        )
        return Response({"success": True, "data": serializer.data})

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AttendanceRequestStatus.SUBMITTED:
            raise ValidationError("Only a pending request can be cancelled.")
        if instance.approval_request is None:
            raise ValidationError("This request has no linked approval to withdraw.")
        approvals.withdraw(instance.approval_request, request.user)
        instance.refresh_from_db()
        write_audit(request.user, "AttendanceRequest.cancelled", "AttendanceRequest", instance.pk)
        return Response({"success": True, "data": AttendanceRequestSerializer(instance).data})

    @action(detail=False, methods=["get"], url_path="approvals/pending")
    def approvals_pending(self, request):
        # Same shape as list() (FrontendEnvelopeMixin), just a different
        # get_queryset() branch (see above) — not reusing list() directly since
        # DRF resolves get_queryset()'s branch from self.action either way.
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
