from django.utils import timezone

from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.exceptions import Conflict
from core.permissions import ScopedEmployeePermission
from core.scope import resolve_employee_scope
from orgchanges.models import OrgChange
from orgchanges.serializers import OrgChangeSerializer, OrgChangeWriteSerializer


class OrgChangeViewSet(
    FrontendEnvelopeMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """Effective-dated org changes.

    Reading (`orgchanges.read`) lists the changes for whoever is in the
    caller's scope (`?employee= ?status= ?change_type=` narrow it further);
    raising or editing (`orgchanges.write`) is create and PATCH only — no PUT
    and no DELETE. Cancelling is a PATCH to `cancelled`; rows that are already
    `effective` or `cancelled` are history and cannot be edited.
    """

    serializer_class = OrgChangeSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "orgchanges.read"
    write_permission = "orgchanges.write"
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        base = OrgChange.objects.select_related("employee__user", "changed_by").order_by(
            "-effective_date", "-created_at"
        )
        if self.action != "list":
            return base
        params = self.request.query_params
        queryset = base.filter(
            employee__in=resolve_employee_scope(self.request.user, self.required_permission)
        )
        if params.get("employee"):
            queryset = queryset.filter(employee_id=params["employee"])
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("change_type"):
            queryset = queryset.filter(change_type=params["change_type"])
        return queryset

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return OrgChangeWriteSerializer
        return super().get_serializer_class()

    def _write_scope(self):
        return resolve_employee_scope(self.request.user, self.write_permission)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = serializer.validated_data["employee"]
        if not self._write_scope().filter(pk=employee.pk).exists():
            raise PermissionDenied("You may not raise changes for this person.")
        with transaction.atomic():
            change = serializer.save(changed_by=request.user)
            write_audit(
                request.user,
                "OrgChange.created",
                "OrgChange",
                change.pk,
                {"after": OrgChangeSerializer(change).data},
            )
        return Response(
            {"success": True, "data": OrgChangeSerializer(change).data},
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        change = self.get_object()  # scope-checked against orgchanges.write
        if change.status != OrgChange.STATUS_PENDING:
            raise Conflict(
                f"This change is already {change.status} and cannot be edited. "
                "Raise a fresh change if the facts have moved on."
            )
        before = OrgChangeSerializer(change).data
        serializer = self.get_serializer(change, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        new_employee = serializer.validated_data.get("employee")
        if new_employee is not None and new_employee.pk != change.employee_id:
            if not self._write_scope().filter(pk=new_employee.pk).exists():
                raise PermissionDenied("You may not move a change onto this person.")
        with transaction.atomic():
            change = serializer.save()
            write_audit(
                request.user,
                "OrgChange.updated",
                "OrgChange",
                change.pk,
                {"before": before, "after": OrgChangeSerializer(change).data},
            )
        return Response({"success": True, "data": OrgChangeSerializer(change).data})


class DueOrgChangesView(viewsets.ViewSet):
    """Read-only peek at what `apply_due_org_changes` would apply next —
    pending rows whose effective date has arrived. (The command itself does
    the applying; this endpoint never writes.)"""

    from rest_framework.permissions import IsAuthenticated

    permission_classes = [IsAuthenticated]

    def list(self, request):
        from core.scope import user_has_permission

        if not (
            user_has_permission(request.user, "orgchanges.read")
            or user_has_permission(request.user, "org.manage")
        ):
            raise PermissionDenied("You may not view pending org changes.")
        due = (
            OrgChange.objects.filter(
                status=OrgChange.STATUS_PENDING, effective_date__lte=timezone.now().date()
            )
            .select_related("employee__user")
            .order_by("effective_date")
        )
        # orgchanges.read may be held at SELF tier (every employee has it), so
        # only org.manage sees the whole org; everyone else sees their scope.
        if not user_has_permission(request.user, "org.manage"):
            due = due.filter(
                employee__in=resolve_employee_scope(request.user, "orgchanges.read")
            )
        return Response({"success": True, "data": OrgChangeSerializer(due, many=True).data})
