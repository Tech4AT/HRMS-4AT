"""Primitive #3 — Approval workflow (docs/ARCHITECTURE.md). ONE generic table
backs every approval flow (leave, expense, asset, exit, …). `request_type` says
which flow; `payload` carries the flow-specific fields. `approver` is decided by
application code at creation (typically the requester's manager) — no routing
engine, no multi-level escalation. pending is the only non-terminal state."""

import uuid

from django.conf import settings
from django.db import models


class RequestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    WITHDRAWN = "withdrawn", "Withdrawn"


TERMINAL = {RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.WITHDRAWN}


class Request(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_type = models.CharField(max_length=64)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="requests_made"
    )
    # Nullable: a requester with no manager (or whose manager has no account)
    # lands unassigned, and HR reassigns it — the escape hatch in the design.
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requests_to_approve",
    )
    status = models.CharField(
        max_length=16, choices=RequestStatus.choices, default=RequestStatus.PENDING
    )
    payload = models.JSONField(default=dict, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["approver", "status"]),
            models.Index(fields=["requester", "status"]),
        ]

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL

    def __str__(self):
        return f"{self.request_type} [{self.status}] by {self.requester_id}"
