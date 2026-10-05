"""The primitive's public surface: two direct function calls other modules
invoke at their own trigger points (docs/ARCHITECTURE.md #5). No broker, no
pub/sub — a module that approves leave calls notify(...) right there."""

import logging

from django.conf import settings
from django.core.mail import send_mail

from .models import Notification

logger = logging.getLogger(__name__)


def notify(user, type: str, title: str, body: str | None = None) -> Notification:
    """Create an in-app notification for `user`. Returns the row."""
    return Notification.objects.create(user=user, type=type, title=title, body=body)


def broadcast_to(users, title: str, body: str | None = None) -> int:
    """One in-app notification each for the given users. Returns the count."""
    count = 0
    for user in users:
        notify(user, "announcement", title, body)
        count += 1
    return count


def broadcast(title: str, body: str | None = None, recipients: str = "all") -> int:
    """Announcement to all active users, or "admins" (superusers). Returns count.
    Sending is an admin action; the caller (endpoint/command) enforces that."""
    from django.contrib.auth import get_user_model

    users = get_user_model().objects.filter(is_active=True)
    if recipients == "admins":
        users = users.filter(is_superuser=True)
    return broadcast_to(users, title, body)


def send_email(to: str, subject: str, body: str) -> bool:
    """Best-effort transactional email. Never raises into the caller's flow — a
    failed email must not roll back the business action that triggered it; it is
    logged instead. In dev EMAIL_BACKEND is the console backend."""
    try:
        send_mail(
            subject,
            body,
            getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@hrms.local"),
            [to],
            fail_silently=False,
        )
        return True
    except Exception:  # noqa: BLE001 — email must never break the caller
        logger.exception("send_email to %s failed", to)
        return False
