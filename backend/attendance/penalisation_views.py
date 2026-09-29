"""PLAN.md Step 8. Two separate views, not one ViewSet with permission-based
branching, since the two audiences need completely different queries: HR sees
every employee's records and can overturn one (`penalisation.manage`, flat —
matches how the project owner described it: "the admin can overturn it", not
a manager-scoped action); an employee sees only their own, read-only, the same
"authenticated + self-scoped, no bespoke permission" shape My Attendance/Leave
self-service already uses (`attendance.read` at `SELF` scope)."""

from decimal import Decimal

from django.db import transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from core.permissions import HasPermissionCode, ScopedEmployeePermission
from leave.models import LeaveBalance
from notifications.service import notify

from .models import PenalisationRecord, PenalisationStatus
from .penalisation_serializers import PenalisationRecordSerializer
from .views import _employee_or_403


class PenalisationViewSet(viewsets.ViewSet):
    """`/attendance/penalisations` — HR-wide list (optionally `?status=`) plus
    the one action a Penalisation ever gets: a direct overturn. No create/
    update/delete — records only ever come from the scheduled auto-apply job."""

    permission_classes = [HasPermissionCode]
    required_permission = "penalisation.manage"

    def list(self, request):
        qs = PenalisationRecord.objects.select_related(
            "employee__user", "overturned_by__user"
        ).order_by("-absent_date")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response({"success": True, "data": PenalisationRecordSerializer(qs, many=True).data})

    @action(detail=True, methods=["post"], url_path="overturn")
    def overturn(self, request, pk=None):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "A reason is required to overturn a penalisation."})

        # Locked (PLAN.md Step 12): select_for_update() on the record itself
        # guards against two simultaneous overturn calls both passing the
        # "not already overturned" check before either commits (a
        # double-reversal would credit the leave back twice); locking the
        # balance row too protects the same mutation as views.py's and
        # penalisation.py's — a concurrent write to the same balance can't
        # silently overwrite this reversal.
        with transaction.atomic():
            # `of=("self",)`: Postgres refuses to lock across a LEFT OUTER
            # JOIN on a nullable FK (`overturned_by`/`leave_balance` both
            # are) - restricts the row lock to PenalisationRecord itself
            # while still eagerly joining the rest for the serializer below.
            record = (
                PenalisationRecord.objects.select_for_update(of=("self",))
                .filter(pk=pk)
                .select_related("employee__user", "overturned_by__user", "leave_balance")
                .first()
            )
            if record is None:
                raise NotFound("Penalisation record not found.")
            if record.status == PenalisationStatus.OVERTURNED:
                raise ValidationError("This penalisation has already been overturned.")

            # Credit back to the *exact* balance row debited at creation time —
            # not a fresh lookup of "the employee's current balance", which
            # could resolve to a different financial year's row by now.
            if record.leave_balance_id and record.leave_days_deducted:
                balance = LeaveBalance.objects.select_for_update().get(pk=record.leave_balance_id)
                balance.used = max(Decimal("0"), balance.used - record.leave_days_deducted)
                balance.save(update_fields=["used", "updated_at"])
                write_audit(
                    request.user,
                    "LeaveBalance.penalisation_reversed",
                    "LeaveBalance",
                    balance.pk,
                    {"leave_days_restored": str(record.leave_days_deducted)},
                )

            record.status = PenalisationStatus.OVERTURNED
            record.overturned_by = getattr(request.user, "employee", None)
            record.overturned_reason = reason
            record.save(
                update_fields=["status", "overturned_by", "overturned_reason", "updated_at"]
            )

            write_audit(
                request.user,
                "PenalisationRecord.overturned",
                "PenalisationRecord",
                record.pk,
                {"reason": reason},
            )

        notify(
            record.employee.user,
            "penalisation.overturned",
            "A penalisation was overturned",
            reason,
        )
        return Response({"success": True, "data": PenalisationRecordSerializer(record).data})


class MyPenalisationsView(APIView):
    """`/attendance/penalisations/mine` — the caller's own records, read-only.
    No write action here at all: an employee can never request an overturn
    (PLAN.md §1.3, corrected during manual verification) — only see whether
    they've been penalised."""

    permission_classes = [ScopedEmployeePermission]
    required_permission = "attendance.read"

    def get(self, request):
        employee = _employee_or_403(request)
        qs = (
            PenalisationRecord.objects.filter(employee=employee)
            .select_related("overturned_by__user")
            .order_by("-absent_date")
        )
        return Response({"success": True, "data": PenalisationRecordSerializer(qs, many=True).data})
