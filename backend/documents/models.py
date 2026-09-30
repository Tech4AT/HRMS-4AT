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


class DocumentFolder(models.Model):
    """A folder in Org > Organization Documents (the Keka folder rail). PUBLIC
    folders are visible to every employee; PRIVATE folders are HR-only. Deleting
    a folder detaches its documents (Document.folder -> SET_NULL), it does not
    delete them."""

    VISIBILITY_PUBLIC = "public"
    VISIBILITY_PRIVATE = "private"
    VISIBILITY_CHOICES = [(VISIBILITY_PUBLIC, "Public"), (VISIBILITY_PRIVATE, "Private")]

    name = models.CharField(max_length=200)
    visibility = models.CharField(max_length=16, choices=VISIBILITY_CHOICES, default=VISIBILITY_PUBLIC)
    description = models.TextField(blank=True, default="")
    ordering = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["ordering", "name"]

    def __str__(self):
        return f"{self.name} ({self.visibility})"


class Document(models.Model):
    # UUID primary key (matches the real column and migration state 0004; the
    # Python-side default is what makes creates work — without an explicit
    # field Django assumes a DB-generated AutoField and inserts NULL).
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Audience/visibility: who may see this document, enforced in access.py
    # alongside the entity_type rules. It only ever RESTRICTS — never widens
    # past what the entity_type + scope engine already allow. HR Admin always
    # sees everything. Default all_employees preserves existing behavior.
    AUDIENCE_HR_ONLY = "hr_only"
    AUDIENCE_HR_AND_MANAGER = "hr_and_manager"
    AUDIENCE_EMPLOYEE = "employee"
    AUDIENCE_ALL_EMPLOYEES = "all_employees"
    AUDIENCE_CHOICES = [
        (AUDIENCE_HR_ONLY, "HR only"),
        (AUDIENCE_HR_AND_MANAGER, "HR + Manager"),
        (AUDIENCE_EMPLOYEE, "Employee (owner only)"),
        (AUDIENCE_ALL_EMPLOYEES, "All employees"),
    ]
    audience = models.CharField(max_length=32, choices=AUDIENCE_CHOICES, default=AUDIENCE_ALL_EMPLOYEES)
    # Whether employees must explicitly acknowledge this document (tracked in
    # DocumentAcknowledgement below).
    acknowledgement_required = models.BooleanField(default=False)
    # Organization-documents subsystem: the folder this document lives in (Org
    # > Organization Documents folder rail). Null for employee-attached files.
    # SET_NULL so deleting a folder detaches, never deletes, its documents.
    folder = models.ForeignKey(
        "DocumentFolder", null=True, blank=True, on_delete=models.SET_NULL, related_name="documents"
    )
    # Human-entered display name + description for organization documents (the
    # Add-document panel). Employee-attached files leave these blank and fall
    # back to original_filename for display.
    title = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
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


class DocumentAcknowledgement(models.Model):
    """One row per (document, employee) pair recording that the employee
    acknowledged the document. Created/updated by POST
    /documents/<id>/acknowledge; read scope-filtered by GET
    /documents/<id>/acknowledgements."""

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="acknowledgements")
    employee = models.ForeignKey(
        "employees.Employee",
        on_delete=models.CASCADE,
        related_name="document_acknowledgements",
    )
    acknowledged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-acknowledged_at"]
        constraints = [
            models.UniqueConstraint(fields=["document", "employee"], name="unique_document_acknowledgement")
        ]
        indexes = [models.Index(fields=["document", "employee"])]

    def __str__(self):
        return f"{self.document_id} acknowledged by {self.employee_id}"
