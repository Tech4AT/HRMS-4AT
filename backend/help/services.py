"""Notification trigger points for the help module - direct function calls at
create/status-update/reopen time, mirroring notifications/service.py's own
convention (no broker/pub-sub, see that module's docstring)."""

from django.contrib.auth import get_user_model
from django.db.models import Q

from accounts.models import RolePermission, UserPermissionOverride
from notifications import service as notifications

from .models import CategoryAssignment

_HELP_MANAGE = "help.manage"


def _users_holding_help_manage():
    """Every active user whose role (or an explicit override) currently grants
    help.manage - who the help desk queue's "new ticket" broadcast reaches.
    An override deny always wins, same precedence as core.scope's resolver."""
    role_ids = RolePermission.objects.filter(
        permission__code=_HELP_MANAGE, role__is_active=True
    ).values_list("role_id", flat=True)
    granted_ids = UserPermissionOverride.objects.filter(
        permission__code=_HELP_MANAGE, is_granted=True
    ).values_list("user_id", flat=True)
    denied_ids = UserPermissionOverride.objects.filter(
        permission__code=_HELP_MANAGE, is_granted=False
    ).values_list("user_id", flat=True)

    User = get_user_model()
    return (
        User.objects.filter(Q(role_id__in=role_ids) | Q(pk__in=granted_ids))
        .exclude(pk__in=denied_ids)
        .distinct()
    )


def notify_help_desk(category: str, title: str, body: str | None = None) -> None:
    """A ticket was created, edited or reopened - tell everyone who can triage
    it: every help.manage holder, plus this category's routed owner
    specifically. CanResolveTickets (help/views.py) grants a category owner
    Resolve Tickets access without requiring help.manage, so the flat
    holder-list alone would silently never notify them about their own
    queue."""
    recipients = list(_users_holding_help_manage())
    assignment = (
        CategoryAssignment.objects.filter(category=category).select_related("assignee__user").first()
    )
    if assignment is not None and assignment.assignee.user_id not in {u.pk for u in recipients}:
        recipients.append(assignment.assignee.user)
    notifications.broadcast_to(recipients, title, body)


def notify_requester(ticket, title: str, body: str | None = None) -> None:
    """A ticket's status changed - tell the person who raised it."""
    notifications.notify(ticket.employee.user, "help.status_changed", title, body)
