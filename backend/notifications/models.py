"""Primitive #5 — Notifications (docs/ARCHITECTURE.md). One row per message to
one user; a notification is *owned by a user*, so access is self-scoped (you see
your own), not resolved through the RBAC employee-scope engine. Creation and
email are direct function calls at trigger points — see notifications/service.py.
"""

import uuid

from django.conf import settings
from django.db import models


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    # Dotted trigger key, e.g. "leave.approved" — free-form, owned by the caller.
    type = models.CharField(max_length=100)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True, null=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read_at"])]

    def __str__(self):
        return f"{self.type} → {self.user_id}"
