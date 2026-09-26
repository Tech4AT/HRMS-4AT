"""Primitive #6 — File storage (docs/ARCHITECTURE.md). One `Document` row per
stored file, attached to some entity by (entity_type, entity_id). The row IS the
abstraction — access is derived from a per-entity_type matrix (see access.py),
not from a storage interface layer. Bytes live on disk (MEDIA_ROOT) now; swapping
to S3 later is a storage-backend change, not a schema change."""

import uuid

from django.conf import settings
from django.db import models


def _upload_to(instance, filename):
    return f"documents/{instance.entity_type}/{uuid.uuid4()}/{filename}"


class Document(models.Model):
    # UUID primary key (matches the real column and migration state 0004; the
    # Python-side default is what makes creates work — without an explicit
    # field Django assumes a DB-generated AutoField and inserts NULL).
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # What this file is attached to, e.g. ("payslip", <employee id>).
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64)
    # Direct owner link used by the onboarding module (additive, nullable —
    # existing rows are untouched). The (entity_type, entity_id) pair above
    # remains the primary attachment mechanism.
    employee = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    file = models.FileField(upload_to=_upload_to)
    original_name = models.CharField(max_length=255)
    # Filename as the teammate's onboarding module passes it
    # (Document.objects.create(..., original_filename=...)). Mirrored with
    # original_name in save() so the two never diverge; see the docstring
    # there. Additive column — existing rows are untouched.
    original_filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=127, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    expiry_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-uploaded_at"]
        indexes = [models.Index(fields=["entity_type", "entity_id"])]

    def __str__(self):
        return f"{self.entity_type}:{self.entity_id}/{self.original_name}"

    def save(self, *args, **kwargs):
        """Empty-fill mirror between original_name and original_filename.
        Only fills a side that is empty — never overwrites existing values."""
        if not self.original_filename and self.original_name:
            self.original_filename = self.original_name
        elif not self.original_name and self.original_filename:
            self.original_name = self.original_filename
        super().save(*args, **kwargs)


class DocumentAccessLog(models.Model):
    """Every time a file's bytes actually leave the server (not just its
    metadata being listed) — a stricter, narrower log than audit.AuditLog,
    which already tracks upload/delete. This one exists specifically to
    answer "who has looked at or pulled a copy of this file", including the
    requesting IP. Additive model for the onboarding hybrid layer."""

    ACTION_VIEWED = "viewed"
    ACTION_DOWNLOADED = "downloaded"
    ACTION_CHOICES = [
        (ACTION_VIEWED, "Viewed"),
        (ACTION_DOWNLOADED, "Downloaded"),
    ]

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="access_logs")
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["document", "-created_at"])]

    def __str__(self):
        return f"{self.document_id} {self.action} by {self.performed_by_id}"
