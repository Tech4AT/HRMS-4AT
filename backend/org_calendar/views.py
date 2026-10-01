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

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.enums import EmployeeStatus
from core.permissions import HasPermissionCode
from employees.models import Employee
from org_calendar.models import Calendar, CalendarEntry, RecurringWfhRule
from org_calendar.resolution import resolve_calendar_range
from org_calendar.serializers import (
    CalendarEntrySerializer,
    CalendarSerializer,
    RecurringWfhRuleSerializer,
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
    """/calendar/entries - CRUD for one-off holidays, WFH days, and events of a
    calendar (`calendar_id` on write, `?calendar=<id>` to filter).
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
        calendar_id = params.get("calendar")
        if calendar_id:
            queryset = queryset.filter(calendar_id=calendar_id)
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
    serializer_class = RecurringWfhRuleSerializer
    audit_entity_name = "RecurringWfhRule"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = RecurringWfhRule.objects.all()
        calendar_id = self.request.query_params.get("calendar")
        return queryset.filter(calendar_id=calendar_id) if calendar_id else queryset


class CalendarViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    """/calendar/calendars - CRUD for calendars: name, who they cover
    (departments and/or individual employees) and their weekly offs, which are
    written and read as one nested `week_offs` list (a PUT/PATCH that includes
    it replaces the whole list). A calendar's holidays, events and WFH rules
    live on /calendar/entries and /calendar/recurring-wfh, filtered by
    `?calendar=<id>`. Deleting a calendar deletes those too."""

    permission_classes = [HasPermissionCode]
    required_permission = "calendar.manage"
    serializer_class = CalendarSerializer
    audit_entity_name = "Calendar"
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Calendar.objects.prefetch_related("departments", "employees", "week_offs")

    @action(detail=False, methods=["get"])
    def coverage(self, request):
        """Active employees no calendar covers - they currently have no weekly
        offs, holidays, events or WFH days, so HR needs to see who they are."""
        covered = Employee.objects.filter(
            Q(calendars__isnull=False) | Q(department__calendars__isnull=False)
        ).values("pk")
        active = Employee.objects.filter(status=EmployeeStatus.ACTIVE)
        uncovered = (
            active.exclude(pk__in=covered)
            .select_related("user", "department")
            .order_by("employee_code")
        )
        return Response(
            {
                "success": True,
                "data": {
                    "active_employees": active.count(),
                    "unassigned_count": uncovered.count(),
                    "unassigned": [
                        {
                            "id": str(e.pk),
                            "name": f"{e.user.first_name} {e.user.last_name}".strip(),
                            "department": e.department.name if e.department_id else None,
                        }
                        for e in uncovered[:100]
                    ],
                },
            }
        )


class MyEventsView(APIView):
    """GET /calendar/my-events?from=&to= - the signed-in employee's own events
    (default: today through the next 60 days, at most one year), merged across
    every calendar that covers them (org_calendar/resolution.py). Open to any
    signed-in employee: it only ever returns the caller's own calendars, unlike
    the calendar.manage endpoints above. Someone covered by no calendar gets an
    empty list."""

    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        start = parse_date(request.query_params.get("from") or "") or today
        end = parse_date(request.query_params.get("to") or "") or start + timedelta(days=60)
        if end < start or (end - start).days > 366:
            raise ValidationError("'to' must be on or after 'from', at most a year later.")
        employee = getattr(request.user, "employee", None)
        data = []
        if employee is not None:
            for day, facts in resolve_calendar_range(employee, start, end).items():
                data.extend(
                    {"date": day.isoformat(), "name": e.name, "description": e.description}
                    for e in facts.events
                )
        return Response({"success": True, "data": data})
