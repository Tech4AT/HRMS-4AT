"""PLAN.md Step 6 — Shifts and Policy Settings. Both are org-admin
configuration, not employee-keyed data, so both use the flat `HasPermissionCode`
check against `attendance.settings.manage` (org_calendar's pattern for
CalendarEntry/RecurringWfhRule/WeekOff — Step 2), not `ScopedEmployeePermission`.

`attendance.settings.manage` is **registered by `leave`, not here** — it's
already the exact hardcoded frontend string gating Shifts, Leave Settings, and
Policy Settings (PLAN.md §6.1/§10.1), and Leave (Step 4) needed it first among
the three areas that share it. Per the registry's one-owning-registration rule
(core/registry.py), this app only references the code string in
`required_permission` below; it must not call `register_permissions()` for it
again."""

from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from core.permissions import HasPermissionCode

from .models import PolicySettings, Shift
from .settings_serializers import PolicySettingsSerializer, ShiftSerializer

MANAGE = "attendance.settings.manage"


class EnvelopeMixin:
    """Wraps create/update/destroy in {success, data} and audits every
    mutation — same shape as org_calendar's local EnvelopeMixin, but without
    overriding renderer_classes/parser_classes: unlike org_calendar/attendance/
    leave, `Shift` has no existing wire contract to preserve (its frontend,
    `lib/attendance/shifts.ts`, is still local component state with no API
    client), so this inherits the project's default CamelCase renderer/parser
    instead of forcing snake_case — the frontend's own field names
    (`startTime`, `employeeIds`, ...) come out for free."""

    audit_entity_name: str = ""
    pagination_class = None

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

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({"success": True, "data": serializer.data})

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response({"success": True, "data": self.get_serializer(instance).data})

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


class ShiftViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    """/attendance/shifts — full CRUD, matching `lib/attendance/shifts.ts`'s
    `Shift` shape exactly. `employee_ids` fully replaces the assignment on
    every write (never incremental) — matches `ShiftsSettingsPanel.tsx`'s own
    behaviour (the assignment modal always returns the complete selected list)."""

    permission_classes = [HasPermissionCode]
    required_permission = MANAGE
    queryset = Shift.objects.all().prefetch_related("employees")
    serializer_class = ShiftSerializer
    audit_entity_name = "Shift"


class PolicySettingsView(APIView):
    """/attendance/policy-settings — a singleton, not a list resource (there is
    exactly one Policy Settings row, `PolicySettings.load()`), so this is a
    plain APIView rather than a router-registered ViewSet: GET reads it, PUT
    replaces it wholesale — matching `PenalizationSettingsPanel.tsx`'s own
    save flow, which always sends the complete settings object, never a
    partial one."""

    permission_classes = [HasPermissionCode]
    required_permission = MANAGE

    def get(self, request):
        instance = PolicySettings.load()
        return Response({"success": True, "data": PolicySettingsSerializer(instance).data})

    def put(self, request):
        instance = PolicySettings.load()
        before = PolicySettingsSerializer(instance).data
        serializer = PolicySettingsSerializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        write_audit(
            request.user,
            "PolicySettings.updated",
            "PolicySettings",
            instance.pk,
            {"before": before, "after": serializer.data},
        )
        return Response({"success": True, "data": serializer.data})
