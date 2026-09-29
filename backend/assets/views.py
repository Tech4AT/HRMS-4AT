from django.shortcuts import get_object_or_404
from rest_framework import filters

from audit.mixins import AuditedModelViewSet
from assets.models import Asset
from assets.serializers import AssetSerializer
from core.enums import ScopeTier
from core.pagination import ContractPageNumberPagination
from core.permissions import ScopedEmployeePermission, required_permission_for
from core.scope import explain_permission, resolve_employee_scope


def _is_all_scope(user, code) -> bool:
    """Whether `user` holds `code` at ALL tier (the whole inventory,
    including unassigned stock)."""
    return explain_permission(user, code).get("tier") == ScopeTier.ALL


class AssetViewSet(AuditedModelViewSet):
    """The asset inventory.

    `list` is filtered through resolve_employee_scope() on assigned_to: an
    ALL grant (HR/IT Admin) sees the whole fleet including unassigned stock;
    a narrower grant (every employee holds SELF via the baseline) sees only
    assets assigned to employees in scope. Detail routes return the full
    queryset so an out-of-scope record is an explicit 403, not a 404 —
    ScopedEmployeePermission checks it via Asset.employee_id, except an
    unassigned asset has no employee to check against, so those are
    ALL-holders-only (see get_object)."""

    serializer_class = AssetSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "assets.read"
    write_permission = "assets.write"
    pagination_class = ContractPageNumberPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["asset_tag", "brand", "serial", "processor"]
    ordering_fields = ["asset_tag", "brand", "date_of_allotment"]
    ordering = ["asset_tag"]
    audit_entity_type = "Asset"

    def get_queryset(self):
        queryset = Asset.objects.select_related("assigned_to__user").all()
        if self.action != "list":
            # Detail routes scope-check per object (403, not 404).
            return queryset
        if not _is_all_scope(self.request.user, self.required_permission):
            scope = resolve_employee_scope(self.request.user, self.required_permission)
            queryset = queryset.filter(assigned_to__in=scope)
        status = self.request.query_params.get("status")
        if status == Asset.STATUS_ASSIGNED:
            queryset = queryset.filter(assigned_to__isnull=False)
        elif status == Asset.STATUS_RECOVERED:
            queryset = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=False)
        elif status == Asset.STATUS_AVAILABLE:
            queryset = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=True)
        assigned = self.request.query_params.get("assigned")
        if assigned == "true":
            queryset = queryset.filter(assigned_to__isnull=False)
        elif assigned == "false":
            queryset = queryset.filter(assigned_to__isnull=True)
        return queryset

    def get_object(self):
        queryset = self.filter_queryset(self.get_queryset())
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        obj = get_object_or_404(queryset, **{self.lookup_field: self.kwargs[lookup_url_kwarg]})
        if obj.assigned_to_id is None:
            # No employee to scope-check against: unassigned stock is
            # visible only to ALL-tier holders of this action's code.
            code = required_permission_for(self, strict=True)
            if not _is_all_scope(self.request.user, code):
                self.permission_denied(self.request, message="Not in scope.")
            return obj
        self.check_object_permissions(self.request, obj)
        return obj
