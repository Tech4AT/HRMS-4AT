"""Document templates engine — reusable letter/agreement/compliance-form shells.

Lives in its OWN app (not `documents`) so its migrations never collide with
the parallel verification worker, which owns the documents app.
"""

from django.conf import settings
from django.db import models


class TemplateFolder(models.Model):
    """A grouping bucket for templates (mirrors the Keka Folder filter)."""

    name = models.CharField(max_length=150, unique=True)
    ordering = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["ordering", "name"]

    def __str__(self):
        return self.name


class DocumentTemplate(models.Model):
    """One reusable document shell. `body` is the text with optional
    {{placeholder}} tokens; `file` an uploaded source file (either may be
    used — generate renders body when present, else echoes the file)."""

    ACTION_DOCUMENT_GENERATION = "document_generation"

    ACTION_CHOICES = (
        (ACTION_DOCUMENT_GENERATION, "Document Generation"),
    )

    name = models.CharField(max_length=255, db_index=True)
    folder = models.ForeignKey(
        TemplateFolder,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="templates",
    )
    action_type = models.CharField(
        max_length=50, choices=ACTION_CHOICES, default=ACTION_DOCUMENT_GENERATION
    )
    workflow_enabled = models.BooleanField(default=False)
    body = models.TextField(blank=True, default="")
    file = models.FileField(upload_to="template_files/", null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_templates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["folder"])]

    def __str__(self):
        return self.name
