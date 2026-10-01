import base64
import binascii
import csv

from django.db.models import Count
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from audit.mixins import AuditedModelViewSet
from audit.service import write_audit
from assets.importer import import_asset_rows, rows_from_upload
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
    # Custom actions must map their own code (strict mode won't fall back).
    action_permissions = {"import_file": "assets.write", "export": "assets.read", "stats": "assets.read"}
    pagination_class = ContractPageNumberPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["asset_tag", "brand", "serial", "processor"]
    ordering_fields = ["asset_tag", "brand", "date_of_allotment"]
    ordering = ["asset_tag"]
    audit_entity_type = "Asset"
    # list + the two custom collection reads share scope + query-param filters;
    # detail routes (retrieve/update/destroy) scope-check per object instead.
    LIST_LIKE = {"list", "export", "stats"}

    def get_queryset(self):
        queryset = Asset.objects.select_related("assigned_to__user").all()
        if self.action not in self.LIST_LIKE:
            # Detail routes scope-check per object (403, not 404).
            return queryset
        if not _is_all_scope(self.request.user, self.required_permission):
            scope = resolve_employee_scope(self.request.user, self.required_permission)
            queryset = queryset.filter(assigned_to__in=scope)
        return self._apply_filters(queryset)

    def _apply_filters(self, queryset):
        """Manual query-param filters (django-filter is not installed). Shared
        by list, export and stats so a filtered CSV/KPI matches the table."""
        params = self.request.query_params
        status = params.get("status")
        if status == Asset.STATUS_ASSIGNED:
            queryset = queryset.filter(assigned_to__isnull=False)
        elif status == Asset.STATUS_RECOVERED:
            queryset = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=False)
        elif status == Asset.STATUS_AVAILABLE:
            queryset = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=True)
        assigned = params.get("assigned")
        if assigned == "true":
            queryset = queryset.filter(assigned_to__isnull=False)
        elif assigned == "false":
            queryset = queryset.filter(assigned_to__isnull=True)
        category = params.get("category")
        if category:
            queryset = queryset.filter(category__iexact=category)
        brand = params.get("brand")
        if brand:
            queryset = queryset.filter(brand__icontains=brand)
        has_bag = params.get("has_bag")
        if has_bag == "true":
            queryset = queryset.filter(has_bag=True)
        elif has_bag == "false":
            queryset = queryset.filter(has_bag=False)
        for param, lookup in (
            ("allotted_from", "date_of_allotment__gte"),
            ("allotted_to", "date_of_allotment__lte"),
            ("recovered_from", "date_of_recover__gte"),
            ("recovered_to", "date_of_recover__lte"),
        ):
            value = params.get(param)
            if value:
                queryset = queryset.filter(**{lookup: value})
        year = params.get("allotted_year")
        if year and year.isdigit():
            queryset = queryset.filter(date_of_allotment__year=int(year))
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

    @action(detail=False, methods=["post"], url_path="import")
    def import_file(self, request):
        """Bulk-upsert assets from an uploaded CSV/xlsx (idempotent by asset
        tag). Whole-fleet write, so ALL-tier assets.write only. The file is
        sent base64-encoded in JSON (`{filename, contentBase64}`) because the
        API proxy forwards JSON, not multipart."""
        if not _is_all_scope(request.user, self.write_permission):
            self.permission_denied(request, message="Importing assets needs full assets.write access.")

        # The camel-case parser snake_cases JSON keys, so accept both spellings.
        filename = (request.data.get("filename") or "upload.csv").strip()
        encoded = (
            request.data.get("contentBase64")
            or request.data.get("content_base64")
            or request.data.get("content_base_64")
            or ""
        )
        if "," in encoded and encoded.strip().startswith("data:"):
            encoded = encoded.split(",", 1)[1]  # strip a data: URL prefix
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            return Response({"detail": "Could not decode the uploaded file."}, status=status.HTTP_400_BAD_REQUEST)
        if not raw:
            return Response({"detail": "The uploaded file is empty."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rows = rows_from_upload(filename, raw)
            summary = import_asset_rows(rows)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"detail": "Could not read the file — check it is the asset tracker export."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Stream the scope + filter matched inventory as a CSV attachment.
        Same filters as list, so the download mirrors the on-screen table."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="assets.csv"'
        writer = csv.writer(response)
        writer.writerow([
            "Asset tag", "Category", "Brand", "Serial", "Processor", "RAM",
            "Date of allotment", "Date of recover", "Has bag", "Status",
            "Assigned to code", "Assigned to name", "Previously used",
        ])
        for a in queryset:
            emp = a.assigned_to
            user = getattr(emp, "user", None)
            writer.writerow([
                a.asset_tag, a.category, a.brand, a.serial, a.processor, a.ram,
                a.date_of_allotment or "", a.date_of_recover or "",
                "yes" if a.has_bag else "no", a.status,
                getattr(emp, "employee_code", "") if emp else "",
                user.get_full_name().strip() if user else "",
                a.previously_used,
            ])
        write_audit(request.user, "asset.export", self.audit_entity_type, None, {"count": queryset.count()})
        return response

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """KPI counts over the scoped (and optionally filtered) queryset."""
        queryset = self.filter_queryset(self.get_queryset())
        assigned = queryset.filter(assigned_to__isnull=False).count()
        recovered = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=False).count()
        available = queryset.filter(assigned_to__isnull=True, date_of_recover__isnull=True).count()
        by_category = {
            row["category"]: row["n"]
            for row in queryset.values("category").annotate(n=Count("id")).order_by("category")
        }
        return Response({
            "total": queryset.count(),
            "assigned": assigned,
            "available": available,
            "recovered": recovered,
            "by_category": by_category,
            "issued_this_year": queryset.filter(date_of_allotment__year=timezone.now().year).count(),
        })
