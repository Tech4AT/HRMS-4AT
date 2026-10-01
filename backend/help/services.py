"""Notification trigger points for the help module - direct function calls at
create/status-update/reopen time, mirroring notifications/service.py's own
convention (no broker/pub-sub, see that module's docstring)."""

from django.contrib.auth import get_user_model
from django.db.models import Count, Q

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
        # Users hold roles many-to-many, so match through `roles`.
        User.objects.filter(Q(roles__in=role_ids) | Q(pk__in=granted_ids))
        .exclude(pk__in=denied_ids)
        .distinct()
    )


def category_owners(category: str) -> list:
    """The employees who own `category`, in the order they were added."""
    return [
        a.assignee
        for a in CategoryAssignment.objects.filter(category=category).select_related(
            "assignee__user"
        )
    ]


def pick_assignee(category: str, current=None):
    """Who a ticket in `category` should be assigned to, or None if the category
    has no owners.

    With several owners the ticket goes to whoever has the fewest open tickets,
    the longest-standing owner winning a tie, so work spreads out and the choice
    is predictable. If `current` (the ticket's present assignee) already owns the
    category they are kept, so an edit never shuffles a ticket between owners."""
    owners = category_owners(category)
    if not owners:
        return None
    if current is not None and any(o.pk == current.pk for o in owners):
        return current

    from .models import Ticket, TicketStatus

    open_counts = dict(
        Ticket.objects.filter(assigned_to__in=owners)
        .exclude(status__in=[TicketStatus.RESOLVED, TicketStatus.CLOSED])
        .values_list("assigned_to")
        .annotate(n=Count("pk"))
    )
    # min() keeps the first of equals, and `owners` is in the order they were added.
    return min(owners, key=lambda o: open_counts.get(o.pk, 0))


def notify_help_desk(category: str, title: str, body: str | None = None) -> None:
    """A ticket was created, edited or reopened - tell everyone who can triage
    it: every help.manage holder, plus every owner of this category.
    CanResolveTickets (help/views.py) grants a category owner Resolve Tickets
    access without requiring help.manage, so the flat holder-list alone would
    silently never notify them about their own queue."""
    recipients = list(_users_holding_help_manage())
    seen = {u.pk for u in recipients}
    for owner in category_owners(category):
        if owner.user_id not in seen:
            seen.add(owner.user_id)
            recipients.append(owner.user)
    notifications.broadcast_to(recipients, title, body)


def notify_requester(ticket, title: str, body: str | None = None) -> None:
    """A ticket's status changed - tell the person who raised it."""
    notifications.notify(ticket.employee.user, "help.status_changed", title, body)
