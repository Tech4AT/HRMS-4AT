"""HRMS side of the LMS integration (Data Mapping & Integration Design §3).

Ownership (PRD §2): HRMS owns employee/org facts and pushes them out;
the LMS owns learning facts and pushes them back. Nothing here is edited by
HRMS users directly — the projection tables are written only by inbound LMS
events (inbound.py), the link and event tables only by the integration code.

- LmsIdentityLink        one HRMS employee <-> one LMS learner
- IntegrationEvent       the event envelope, both directions (an outbox for
                         HRMS -> LMS, an idempotent inbox for LMS -> HRMS)
- IntegrationDelivery    one row per outbound delivery attempt
- Learning*/Assessment*/Certification*/Skill*  read projections of LMS data
- ReconciliationRun      the result of a scheduled / on-demand reconcile
"""

import uuid

from django.conf import settings
from django.db import models


def new_event_id() -> str:
    return f"evt_{uuid.uuid4().hex}"


def new_correlation_id() -> str:
    return f"corr_{uuid.uuid4().hex}"


class LinkStatus(models.TextChoices):
    PENDING = "pending", "Pending provisioning"
    LINKED = "linked", "Linked"
    DEACTIVATED = "deactivated", "Deactivated"
    CONFLICT = "conflict", "Conflict — needs resolution"


class LmsIdentityLink(models.Model):
    employee = models.OneToOneField(
        "employees.Employee", on_delete=models.CASCADE, related_name="lms_link"
    )
    # Null until the LMS confirms which learner this employee is. Unique so
    # one learner can never be linked to two employees (Data Mapping §4:
    # "block duplicate links and require explicit resolution").
    learner_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    status = models.CharField(max_length=20, choices=LinkStatus.choices, default=LinkStatus.PENDING)
    linked_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_id"]

    def __str__(self):
        return f"{self.employee_id} -> {self.learner_id or '?'} ({self.status})"


class EventDirection(models.TextChoices):
    OUTBOUND = "outbound", "HRMS → LMS"
    INBOUND = "inbound", "LMS → HRMS"


class SyncStatus(models.TextChoices):
    """API & Event Contract §5."""

    PENDING = "PENDING", "Pending"
    PROCESSING = "PROCESSING", "Processing"
    SUCCEEDED = "SUCCEEDED", "Succeeded"
    RETRYING = "RETRYING", "Retrying"
    FAILED = "FAILED", "Failed"
    RECONCILED = "RECONCILED", "Reconciled"


# Statuses that still need the dispatcher's attention.
OPEN_STATUSES = (SyncStatus.PENDING, SyncStatus.RETRYING, SyncStatus.PROCESSING)


class IntegrationEvent(models.Model):
    event_id = models.CharField(max_length=80, unique=True, default=new_event_id)
    event_type = models.CharField(max_length=50)
    schema_version = models.CharField(max_length=10, default="1.0")
    direction = models.CharField(max_length=10, choices=EventDirection.choices)
    source = models.CharField(max_length=20)
    correlation_id = models.CharField(max_length=80, default=new_correlation_id)
    employee = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lms_events",
    )
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=12, choices=SyncStatus.choices, default=SyncStatus.PENDING)
    attempt_count = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    processed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["direction", "status", "next_attempt_at"]),
            models.Index(fields=["employee", "direction", "status"]),
            models.Index(fields=["event_type"]),
        ]

    def __str__(self):
        return f"{self.event_type} {self.event_id} ({self.status})"


class IntegrationDelivery(models.Model):
    event = models.ForeignKey(IntegrationEvent, on_delete=models.CASCADE, related_name="deliveries")
    target = models.CharField(max_length=300)
    attempt_no = models.PositiveIntegerField()
    succeeded = models.BooleanField(default=False)
    http_status = models.PositiveIntegerField(null=True, blank=True)
    error = models.TextField(blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    attempted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class LearningStatus(models.TextChoices):
    ASSIGNED = "assigned", "Assigned"
    IN_PROGRESS = "in_progress", "In progress"
    COMPLETED = "completed", "Completed"


class ProjectionBase(models.Model):
    """Every projection row remembers the LMS event time it reflects, so an
    older event arriving late never overwrites newer state."""

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="+")
    source_event_id = models.CharField(max_length=80, blank=True)
    source_occurred_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class LearningEnrollment(ProjectionBase):
    """One course (or learning-path item) assigned to an employee."""

    course_id = models.CharField(max_length=64)
    title = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=120, blank=True)
    path_id = models.CharField(max_length=64, blank=True)
    path_name = models.CharField(max_length=255, blank=True)
    mandatory = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20, choices=LearningStatus.choices, default=LearningStatus.ASSIGNED
    )
    progress = models.PositiveSmallIntegerField(default=0)  # 0-100
    assigned_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["employee_id", "-assigned_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "course_id"], name="lms_enrollment_unique"),
        ]


class AssessmentResult(ProjectionBase):
    assessment_id = models.CharField(max_length=64)
    title = models.CharField(max_length=255, blank=True)
    course_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=30, blank=True)  # passed / failed / completed
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["employee_id", "-completed_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "assessment_id"], name="lms_assessment_unique"
            ),
        ]


class CertificationStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    EXPIRING = "expiring", "Expiring soon"
    EXPIRED = "expired", "Expired"
    REVOKED = "revoked", "Revoked"


class EmployeeCertification(ProjectionBase):
    certification_id = models.CharField(max_length=64)
    name = models.CharField(max_length=255)
    issued_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=CertificationStatus.choices, default=CertificationStatus.ACTIVE
    )
    credential_url = models.URLField(max_length=500, blank=True)

    class Meta:
        ordering = ["employee_id", "expires_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "certification_id"], name="lms_certification_unique"
            ),
        ]


class EmployeeSkill(ProjectionBase):
    skill_id = models.CharField(max_length=64)
    name = models.CharField(max_length=255)
    proficiency = models.CharField(max_length=40, blank=True)
    proficiency_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    evidence_refs = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["employee_id", "name"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "skill_id"], name="lms_skill_unique"),
        ]


class ReconciliationRun(models.Model):
    STATUS_RUNNING = "running"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    trigger = models.CharField(max_length=20, default="manual")  # manual / scheduled
    status = models.CharField(max_length=20, default=STATUS_RUNNING)
    provision = models.BooleanField(default=False)
    summary = models.JSONField(default=dict, blank=True)
    findings = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
