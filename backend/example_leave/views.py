"""Step 2: the view. Everything the core needs is declared as class attributes;
the checks in core/checks.py fail at startup if any of it is missing or wrong."""

from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from approvals import service as approvals
from audit.service import write_audit
from core.permissions import ScopedEmployeePermission
from core.scope import resolve_employee_scope
from example_leave.models import LeaveRequest
from example_leave.serializers import LeaveRequestSerializer


class LeaveRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = LeaveRequestSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "example_leave.read"  # list, retrieve
    write_permission = "example_leave.write"  # create
    action_permissions = {"approve": "example_leave.approve"}  # every custom action

    def get_queryset(self):
        queryset = LeaveRequest.objects.select_related("employee")
        if self.action == "list":
            # Lists must be filtered by scope; detail routes are checked per
            # object by ScopedEmployeePermission.has_object_permission.
            scope = resolve_employee_scope(self.request.user, self.required_permission)
            return queryset.filter(employee_id__in=scope)
        return queryset

    def perform_create(self, serializer):
        # The owner is the caller, derived server-side, never from the body.
        employee = getattr(self.request.user, "employee", None)
        if employee is None:
            raise PermissionDenied("This account has no employee record.")
        serializer.save(employee=employee)
        leave = serializer.instance
        write_audit(
            self.request.user,
            "LeaveRequest.created",
            "LeaveRequest",
            leave.pk,
            {"employee": employee.pk},
        )
        # Plug into the approvals engine (#3): raise a request routed to the
        # caller's manager. The decision comes back via request_decided
        # (handlers.py), which sets this row's status — no direct approve needed.
        approvals.create_request(
            self.request.user,
            "example_leave",
            {"leave_request_id": leave.pk, "reason": leave.reason},
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        leave_request = self.get_object()  # scope-checked against example_leave.approve
        leave_request.status = "approved"
        leave_request.save(update_fields=["status"])
        write_audit(request.user, "LeaveRequest.approved", "LeaveRequest", leave_request.pk)
        return Response({"id": leave_request.pk, "status": leave_request.status})
