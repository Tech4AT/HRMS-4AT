"""Shared plumbing for payroll endpoints: permission class, the PAY_* error
envelope, correlation ids, idempotency keys, pagination and scope checks."""

import json
import uuid

from rest_framework import status as http
from rest_framework import viewsets
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from core.permissions import HasPermissionCode
from core.scope import resolve_employee_scope, user_has_permission
from employees.models import Employee
from payroll import models as m
from payroll.services.common import PayrollError, forbidden, not_found


class PayrollPermission(HasPermissionCode):
    """HasPermissionCode (so the core startup checks verify every code), plus
    `any_permissions = {action: (codes...)}` for read screens several payroll
    roles share, e.g. Finance Reviewer and Auditor reading a structure."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        any_of = (getattr(view, "any_permissions", None) or {}).get(getattr(view, "action", None))
        if any_of:
            return any(user_has_permission(request.user, code) for code in any_of)
        return super().has_permission(request, view)


CONFIG_READERS = (
    "payroll.manage",
    "payroll.process",
    "payroll.review",
    "payroll.approve",
    "payroll.audit",
    "payroll.write",
)
RUN_READERS = (
    "payroll.process",
    "payroll.review",
    "payroll.approve",
    "payroll.finalize",
    "payroll.audit",
    "payroll.release",
)


class PayrollViewSet(viewsets.GenericViewSet):
    permission_classes = [PayrollPermission]
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    pagination_class = None

    # -- responses -----------------------------------------------------------

    def handle_exception(self, exc):
        if isinstance(exc, PayrollError):
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": exc.code,
                        "message": exc.message,
                        "fields": exc.fields,
                        "details": exc.details,
                    },
                },
                status=exc.http_status,
            )
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        correlation = getattr(request, "_correlation_id", None) or uuid.uuid4().hex
        response["X-Correlation-ID"] = correlation
        return response

    @staticmethod
    def ok(data, status=http.HTTP_200_OK, meta=None):
        body = {"success": True, "data": data}
        if meta is not None:
            body["meta"] = meta
        return Response(body, status=status)

    def paged(self, items, serialize):
        """Deterministic pagination when ?page is given (contract §3); the
        whole list otherwise, which is what the payroll screens use."""
        page = self.request.query_params.get("page")
        total = (
            items.count() if hasattr(items, "count") and not isinstance(items, list) else len(items)
        )
        if page:
            size = min(int(self.request.query_params.get("page_size") or 50), 500)
            start = (int(page) - 1) * size
            items = items[start : start + size]
            return self.ok(
                serialize(items), meta={"page": int(page), "page_size": size, "total": total}
            )
        return self.ok(serialize(items), meta={"total": total})

    # -- helpers -------------------------------------------------------------

    def can(self, code):
        return user_has_permission(self.request.user, code)

    def scope_ids(self, code="payroll.read"):
        return set(resolve_employee_scope(self.request.user, code).values_list("pk", flat=True))

    def employee_in_scope(self, employee_id, code):
        employee = (
            Employee.objects.select_related(
                "user", "department", "designation", "location", "legal_entity", "manager__user"
            )
            .filter(pk=employee_id)
            .first()
        )
        if employee is None:
            raise not_found("Employee not found.")
        if not resolve_employee_scope(self.request.user, code).filter(pk=employee.pk).exists():
            raise forbidden("This employee is outside your payroll scope.")
        return employee

    def get_or_404(self, model, **lookup):
        obj = model.objects.filter(**lookup).first()
        if obj is None:
            raise not_found(f"{model._meta.verbose_name.title()} not found.")
        return obj

    def idempotent(self, scope, fn):
        """Replay the stored response for a repeated Idempotency-Key."""
        key = self.request.headers.get("Idempotency-Key")
        if not key:
            return fn()
        record = m.IdempotencyRecord.objects.filter(
            key=key, scope=scope, user=self.request.user
        ).first()
        if record is not None:
            return Response(
                record.response, status=record.status_code, headers={"Idempotent-Replay": "true"}
            )
        response = fn()
        if 200 <= response.status_code < 300:
            stored = json.loads(JSONRenderer().render(response.data))
            m.IdempotencyRecord.objects.create(
                key=key,
                scope=scope,
                user=self.request.user,
                status_code=response.status_code,
                response=stored,
            )
        return response
