"""Help desk ticketing (ESSL port). Every access decision goes through
ScopedEmployeePermission + resolve_employee_scope exactly like every other
employee-keyed module (see core.permissions) - this is what replaces ESSL's
shared-secret guard and its case-insensitive email-string ownership matching.
`help.manage` replaces ESSL's single hardcoded technician account.

Detail routes (retrieve/update/update_status/assign/reopen) deliberately query
an *unfiltered* queryset and let has_object_permission do the authorising -
same pattern as example_leave/views.py. Filtering by resolve_employee_scope()
at the queryset level is reserved for `list` (help.read, self-only) and
`queue` (help.manage, whatever scope the caller's role grants); filtering a
detail route's queryset by help.read would 404 a helper trying to act on
someone else's ticket before the correct help.manage object check even runs.
"""

from django.db import transaction
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from core.api import FrontendEnvelopeMixin
from core.enums import EmployeeStatus
from core.permissions import HasPermissionCode, ScopedEmployeePermission
from core.scope import resolve_employee_scope, user_has_permission
from employees.models import Employee

from . import services
from .models import CategoryAssignment, Ticket, TicketActivity, TicketCategory, TicketStatus
from .serializers import CategoryAssignmentSerializer, TicketSerializer, _display_name


def _employee_or_403(request):
    employee = getattr(request.user, "employee", None)
    if employee is None:
        raise PermissionDenied("This account has no employee record.")
    return employee


def _owned_categories(user) -> frozenset:
    """Categories `user` is the routed owner of (CategoryAssignment).
    Ownership is data (who a category routes to), not an RBAC permission
    grant - it's orthogonal to help.read/help.write/help.manage, so it's
    resolved here rather than through core.scope. Memoized on the `user`
    instance for the request's lifetime, same reasoning and pattern as
    core.scope._resolve_effective_scope: a single queue/update_status/assign
    request can otherwise re-run this query up to three times (has_permission,
    has_object_permission, get_queryset)."""
    cache = getattr(user, "_help_owned_categories_cache", None)
    if cache is not None:
        return cache
    employee = getattr(user, "employee", None)
    if employee is None:
        cache = frozenset()
    else:
        cache = frozenset(
            CategoryAssignment.objects.filter(assignee=employee).values_list("category", flat=True)
        )
    user._help_owned_categories_cache = cache
    return cache


def _apply_category_routing(ticket, *, note_prefix: str = "Auto-assigned") -> None:
    """Set `ticket.assigned_to` to one of the owners CategoryAssignment currently
    lists for `ticket.category` (clearing it if there are none), saving and
    logging an 'assigned' activity only when the assignee actually changes.
    Used both on create and whenever an edit changes the category - without
    the latter, a ticket edited into a different category would keep
    pointing at its old category's owner instead of the new one's."""
    # With several owners this picks the least busy one, and keeps the current
    # assignee if they already own the (possibly new) category.
    new_assignee = services.pick_assignee(ticket.category, current=ticket.assigned_to)
    new_assignee_id = new_assignee.pk if new_assignee is not None else None
    if new_assignee_id == ticket.assigned_to_id:
        return
    ticket.assigned_to = new_assignee
    ticket.save(update_fields=["assigned_to"])
    comment = (
        f"{note_prefix} to {_display_name(new_assignee)} ({ticket.category})"
        if new_assignee is not None
        else f"Unassigned - no owner configured for {ticket.category}"
    )
    TicketActivity.objects.create(
        ticket=ticket, event_type=TicketActivity.EventType.ASSIGNED, comment=comment, actor=None
    )


class CanResolveTickets(BasePermission):
    """Who can see/work the Resolve Tickets queue: a help.manage holder (full
    admin, every category), or an employee routed as the owner of at least
    one category (CategoryAssignment) - scoped to just their own categories,
    with no help.manage grant required. Category routing itself
    (CategoryAssignmentView) stays help.manage-only - owning a category lets
    you resolve its tickets, not reassign who owns it."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if user_has_permission(request.user, "help.manage"):
            return True
        return bool(_owned_categories(request.user))

    def has_object_permission(self, request, view, obj):
        if user_has_permission(request.user, "help.manage"):
            return True
        return obj.category in _owned_categories(request.user)


class EnvelopeMixin(FrontendEnvelopeMixin):
    """Same shape as leave/views.py's local EnvelopeMixin - core.api's own
    only covers list/retrieve, this module also needs create/update wrapped."""

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response({"success": True, "data": self.get_serializer(serializer.instance).data}, status=201)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        # `instance` (== serializer.instance) was fetched via get_object(),
        # which prefetches `activities` - a TicketActivity row perform_update
        # may have just created (edited, and re-routed if the category
        # changed) wouldn't show up in the response otherwise, since a
        # prefetched related manager's `.all()` serves its cached snapshot
        # from before those creates, not a fresh query.
        serializer.instance.refresh_from_db()
        return Response({"success": True, "data": self.get_serializer(serializer.instance).data})

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)


class TicketViewSet(
    EnvelopeMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = TicketSerializer
    permission_classes = [ScopedEmployeePermission]
    required_permission = "help.read"  # list, retrieve
    write_permission = "help.write"  # create, update, partial_update
    # queue/update_status/assign are still mapped here so core.checks' static
    # E001/E003 validation passes (it only confirms every custom action has
    # *some* registered permission code, statically, from the class
    # definition) - at request time, get_permissions() below swaps these
    # three to CanResolveTickets, which also admits category owners, not
    # just help.manage holders. The action_permissions entries are what
    # `retrieve`/`update`/`partial_update` etc. still fall back to if ever
    # reached without a get_permissions() override, so they stay accurate.
    action_permissions = {
        "queue": "help.manage",
        "update_status": "help.manage",
        "assign": "help.manage",
        "reopen": "help.write",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("queue", "update_status", "assign"):
            return [CanResolveTickets()]
        return super().get_permissions()

    def get_queryset(self):
        base = Ticket.objects.select_related("employee__user", "assigned_to__user").prefetch_related(
            "activities__actor__employee__user"
        )
        if self.action == "list":
            scope = resolve_employee_scope(self.request.user, self.required_permission)
            return base.filter(employee_id__in=scope)
        if self.action == "queue":
            if user_has_permission(self.request.user, "help.manage"):
                scope = resolve_employee_scope(self.request.user, "help.manage")
                return base.filter(employee_id__in=scope)
            return base.filter(category__in=_owned_categories(self.request.user))
        return base

    def perform_create(self, serializer):
        employee = _employee_or_403(self.request)
        ticket = serializer.save(employee=employee, status=TicketStatus.NEW)
        TicketActivity.objects.create(
            ticket=ticket,
            event_type=TicketActivity.EventType.CREATED,
            new_status=ticket.status,
            actor=self.request.user,
        )
        # Auto-route to whoever owns this category (CategoryAssignment) rather
        # than leaving every new ticket unassigned for a helper to grab - see
        # `assign` below for the manual override/pickup path when no mapping
        # is configured yet.
        _apply_category_routing(ticket)
        write_audit(self.request.user, "Ticket.created", "Ticket", ticket.pk, {"employee": employee.pk})
        services.notify_help_desk(
            ticket.category,
            f"New ticket: {ticket.subject}",
            f"Raised by {_display_name(employee)} · {ticket.category}",
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.status == TicketStatus.CLOSED:
            raise ValidationError("A closed ticket cannot be edited.")
        before = {f: getattr(instance, f) for f in ("subject", "description", "category", "priority")}
        ticket = serializer.save()
        changed = [f for f, old in before.items() if old != getattr(ticket, f)]
        if changed:
            TicketActivity.objects.create(
                ticket=ticket,
                event_type=TicketActivity.EventType.EDITED,
                comment=f"Updated {', '.join(changed)}",
                actor=self.request.user,
            )
            if "category" in changed:
                # The old category's owner (if any) no longer has this ticket
                # in scope - re-route to the new category's owner rather than
                # leaving it pointed at someone who can no longer act on it.
                _apply_category_routing(ticket, note_prefix="Re-routed")
            services.notify_help_desk(
                ticket.category, f"Ticket edited: {ticket.subject}", f"{', '.join(changed)} changed by the requester."
            )
        write_audit(self.request.user, "Ticket.updated", "Ticket", ticket.pk, {"changed": changed})

    @action(detail=False, methods=["get"])
    def queue(self, request):
        queryset = self.get_queryset()
        status_param = request.query_params.get("status")
        priority_param = request.query_params.get("priority")
        category_param = request.query_params.get("category")
        if status_param:
            queryset = queryset.filter(status=status_param)
        if priority_param:
            queryset = queryset.filter(priority=priority_param)
        if category_param:
            queryset = queryset.filter(category=category_param)
        serializer = self.get_serializer(queryset, many=True)
        return Response({"success": True, "data": serializer.data})

    @action(detail=True, methods=["patch"], url_path="status")
    def update_status(self, request, pk=None):
        ticket = self.get_object()
        new_status = request.data.get("status")
        if new_status not in TicketStatus.values:
            raise ValidationError({"status": "Must be a valid ticket status."})
        comment = (request.data.get("comment") or "").strip()
        previous = ticket.status
        ticket.status = new_status
        if comment:
            ticket.admin_comment = comment
        ticket.save(update_fields=["status", "admin_comment", "updated_at"])
        TicketActivity.objects.create(
            ticket=ticket,
            event_type=TicketActivity.EventType.STATUS_UPDATED,
            previous_status=previous,
            new_status=new_status,
            comment=comment or None,
            actor=request.user,
        )
        write_audit(
            request.user, "Ticket.status_updated", "Ticket", ticket.pk, {"from": previous, "to": new_status}
        )
        services.notify_requester(ticket, f"Your ticket status changed to {new_status}", comment or None)
        # See EnvelopeMixin.update()'s comment: `ticket` came from get_object()
        # with `activities` prefetched, so the status-updated row just created
        # above wouldn't otherwise appear in this response.
        ticket.refresh_from_db()
        return Response({"success": True, "data": self.get_serializer(ticket).data})

    @action(detail=True, methods=["patch"])
    def assign(self, request, pk=None):
        ticket = self.get_object()
        assignee = _employee_or_403(request)
        ticket.assigned_to = assignee
        ticket.save(update_fields=["assigned_to", "updated_at"])
        TicketActivity.objects.create(
            ticket=ticket, event_type=TicketActivity.EventType.ASSIGNED, actor=request.user
        )
        write_audit(request.user, "Ticket.assigned", "Ticket", ticket.pk, {"assigned_to": assignee.pk})
        ticket.refresh_from_db()
        return Response({"success": True, "data": self.get_serializer(ticket).data})

    @action(detail=True, methods=["patch"])
    def reopen(self, request, pk=None):
        ticket = self.get_object()
        if ticket.status != TicketStatus.CLOSED:
            raise ValidationError("Only a closed ticket can be reopened.")
        reason = (request.data.get("reason") or "").strip()
        if len(reason) < 5:
            raise ValidationError({"reason": "A reason of at least 5 characters is required."})
        ticket.status = TicketStatus.REOPENED
        ticket.reopen_count += 1
        ticket.escalation_level = min(ticket.reopen_count, 3)
        ticket.save(update_fields=["status", "reopen_count", "escalation_level", "updated_at"])
        TicketActivity.objects.create(
            ticket=ticket,
            event_type=TicketActivity.EventType.REOPENED,
            previous_status=TicketStatus.CLOSED,
            new_status=TicketStatus.REOPENED,
            comment=reason,
            actor=request.user,
        )
        write_audit(
            request.user, "Ticket.reopened", "Ticket", ticket.pk, {"reopen_count": ticket.reopen_count}
        )
        services.notify_help_desk(
            ticket.category, f"Ticket reopened (escalation L{ticket.escalation_level}): {ticket.subject}", reason
        )
        ticket.refresh_from_db()
        return Response({"success": True, "data": self.get_serializer(ticket).data})


MAX_OWNERS_PER_CATEGORY = 25


def _owners_payload(owners) -> list:
    return [{"id": str(o.pk), "name": _display_name(o)} for o in owners]


class CategoryAssignmentView(FrontendEnvelopeMixin, APIView):
    """Category routing config - who owns each category and so is auto-assigned
    its new tickets (TicketViewSet.perform_create). A category can have several
    owners. Not employee-keyed (it's a
    global setting, not a per-employee record), so this uses the flat
    HasPermissionCode check rather than ScopedEmployeePermission.

    Mixes in FrontendEnvelopeMixin only for its plain-JSON renderer/parser
    (its list/retrieve aren't reached - this is a plain APIView, not a
    ViewSet) - without it, the project's default camelCase renderer would
    turn `assignee_id`/`assignee_name` into `assigneeId`/`assigneeName`,
    breaking lib/api/help.ts's snake_case contract for this module."""

    permission_classes = [HasPermissionCode]
    required_permission = "help.manage"

    def get(self, request):
        owners_by_category: dict[str, list] = {}
        for a in CategoryAssignment.objects.select_related("assignee__user"):
            owners_by_category.setdefault(a.category, []).append(a.assignee)
        rows = [
            {"category": category, "assignees": _owners_payload(owners_by_category.get(category, []))}
            for category in TicketCategory.values
        ]
        serializer = CategoryAssignmentSerializer(rows, many=True)
        return Response({"success": True, "data": serializer.data})

    @staticmethod
    def _requested_ids(data) -> list:
        """The owner ids a request asks for, de-duplicated in the order given.
        `assignee_ids` is the list form; the single `assignee_id` the screen used
        before several owners were allowed is still accepted (empty clears)."""
        if "assignee_ids" in data:
            raw = data.get("assignee_ids")
            if not isinstance(raw, list):
                raise ValidationError({"assignee_ids": "Must be a list of employee ids."})
        else:
            single = data.get("assignee_id")
            raw = [single] if single else []
        ids = []
        for value in raw:
            if isinstance(value, bool) or not str(value).strip().isdigit():
                raise ValidationError({"assignee_ids": f"Not a valid employee id: {value!r}."})
            pk = int(str(value).strip())
            if pk not in ids:
                ids.append(pk)
        if len(ids) > MAX_OWNERS_PER_CATEGORY:
            raise ValidationError(
                {"assignee_ids": f"A category can have at most {MAX_OWNERS_PER_CATEGORY} owners."}
            )
        return ids

    def put(self, request):
        """Replace the whole set of owners for one category. Sending an empty
        list clears it. Tickets already assigned to someone removed here keep
        their assignee, as when a category was cleared before."""
        category = request.data.get("category")
        if category not in TicketCategory.values:
            raise ValidationError({"category": "Must be a valid ticket category."})

        ids = self._requested_ids(request.data)
        employees = {
            e.pk: e
            for e in Employee.objects.select_related("user")
            .filter(pk__in=ids)
            .exclude(status=EmployeeStatus.EXITED)
        }
        missing = [pk for pk in ids if pk not in employees]
        if missing:
            raise ValidationError(
                {"assignee_ids": f"Not a current employee: {', '.join(str(m) for m in missing)}."}
            )

        with transaction.atomic():
            current = {a.assignee_id: a for a in CategoryAssignment.objects.filter(category=category)}
            removed = [pk for pk in current if pk not in ids]
            added = [pk for pk in ids if pk not in current]
            if removed:
                CategoryAssignment.objects.filter(category=category, assignee_id__in=removed).delete()
            for pk in added:
                CategoryAssignment.objects.create(category=category, assignee=employees[pk])
            if added or removed:
                write_audit(
                    request.user,
                    "CategoryAssignment.set" if ids else "CategoryAssignment.cleared",
                    "CategoryAssignment",
                    category,
                    {"assignees": ids, "added": added, "removed": removed},
                )

        owners = services.category_owners(category)
        return Response({"success": True, "data": {"category": category, "assignees": _owners_payload(owners)}})


class MyCategoriesView(FrontendEnvelopeMixin, APIView):
    """Which categories the caller should see in the Resolve Tickets category
    rail - every category for a help.manage holder, or just the ones they're
    routed to own otherwise. Deliberately not gated by `help.manage` (unlike
    CategoryAssignmentView, the full routing table): this is only ever the
    caller's own slice of it, so any authenticated user may ask."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        is_admin = user_has_permission(request.user, "help.manage")
        categories = list(TicketCategory.values) if is_admin else list(_owned_categories(request.user))
        return Response({"success": True, "data": {"can_manage": is_admin, "categories": categories}})
