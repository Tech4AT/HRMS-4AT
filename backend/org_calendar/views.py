"""Org calendar views. Neither CalendarEntry nor RecurringWfhRule is
employee-keyed (there's no `employee` FK - see models.py), so these are gated
by the flat HasPermissionCode check against `calendar.manage`, not
ScopedEmployeePermission + resolve_employee_scope. One code covers every
action on purpose (core/permissions.py) - core/checks.py's E003/E004 (custom
action mapping, write_permission) only apply to ScopedEmployeePermission
views, so a flat capability view only ever needs `required_permission`.

Every response is wrapped in the {success, data} envelope in snake_case,
matching frontend/src/lib/api/calendar.ts's `request()` helper, which checks
`json.success` unconditionally on every call including writes and deletes -
core.api.FrontendEnvelopeMixin only covers list/retrieve, so EnvelopeMixin
below extends it to also cover create/update/destroy for this module. Kept
local to this module rather than added to core.api, since that file is core
and only list/retrieve is needed there today."""

from rest_framework import status, viewsets
from rest_framework.response import Response

from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.permissions import HasPermissionCode
from org_calendar.models import CalendarEntry, RecurringWfhRule, WeekOff
from org_calendar.serializers import (
    CalendarEntrySerializer,
    RecurringWfhRuleSerializer,
    WeekOffSerializer,
)


class EnvelopeMixin(FrontendEnvelopeMixin):
    """Wraps create/update/destroy in {success, data} too, and writes an
    audit entry for every mutation (MODULE-GUIDE.md's checklist). Subclasses
    set `audit_entity_name` (e.g. "CalendarEntry") to name the audited entity;
    the audit action is `<entity>.created` / `.updated` / `.deleted`."""

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
        return Response({"success": True, "data": serializer.data}, status=status.HTTP_201_CREATED)

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


class CalendarEntryViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    """/calendar/entries - CRUD for one-off holidays, WFH days, and events.
    The frontend's `updateEntry` always calls PUT with only the fields it
    changed (never the full record), so PUT is always treated as a partial
    update here - matching the mock backend it replaces, which applied each
    field conditionally (`if (body.name) entry.name = body.name`, etc.)."""

    permission_classes = [HasPermissionCode]
    required_permission = "calendar.manage"
    serializer_class = CalendarEntrySerializer
    audit_entity_name = "CalendarEntry"
    http_method_names = ["get", "post", "put", "delete", "head", "options"]

    def get_queryset(self):
        queryset = CalendarEntry.objects.all()
        params = self.request.query_params
        from_date = params.get("from")
        to_date = params.get("to")
        entry_type = params.get("type")
        if from_date:
            queryset = queryset.filter(date__gte=from_date)
        if to_date:
            queryset = queryset.filter(date__lte=to_date)
        if entry_type:
            queryset = queryset.filter(type=entry_type)
        return queryset

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return super().update(request, *args, **kwargs)


class RecurringWfhRuleViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    """/calendar/recurring-wfh - CRUD for the "every <weekday>" WFH rule. The
    frontend only ever PATCHes a subset of fields (e.g. just `active` to
    toggle it), which DRF's partial_update already handles."""

    permission_classes = [HasPermissionCode]
    required_permission = "calendar.manage"
    queryset = RecurringWfhRule.objects.all()
    serializer_class = RecurringWfhRuleSerializer
    audit_entity_name = "RecurringWfhRule"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]


class WeekOffViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    """/calendar/week-off - which weekdays are org-wide non-working days.
    attendance/day_facts.py reads this instead of hardcoding Saturday/Sunday -
    see WeekOff's own docstring for why. Same PATCH-to-toggle shape as
    RecurringWfhRuleViewSet."""

    permission_classes = [HasPermissionCode]
    required_permission = "calendar.manage"
    queryset = WeekOff.objects.all()
    serializer_class = WeekOffSerializer
    audit_entity_name = "WeekOff"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
