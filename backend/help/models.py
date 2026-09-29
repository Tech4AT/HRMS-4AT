"""Support ticketing (ESSL port). `Ticket.employee` is the FK
ScopedEmployeePermission scope-checks every record through, same as every
other employee-keyed module (see example_leave/models.py)."""

from django.conf import settings
from django.db import models


class TicketCategory(models.TextChoices):
    IT_ACCESS = "IT & Access", "IT & Access"
    FACILITIES = "Facilities", "Facilities"
    FOOD = "Food", "Food"
    CAB = "Cab", "Cab"
    FINANCE_ADMIN = "Finance & Admin", "Finance & Admin"
    HR = "HR", "HR"
    OTHERS = "Others", "Others"


class TicketPriority(models.TextChoices):
    LOW = "Low", "Low"
    MEDIUM = "Medium", "Medium"
    HIGH = "High", "High"


class TicketStatus(models.TextChoices):
    NEW = "New", "New"
    IN_PROGRESS = "In progress", "In progress"
    WAITING = "Waiting", "Waiting"
    RESOLVED = "Resolved", "Resolved"
    CLOSED = "Closed", "Closed"
    REOPENED = "Reopened", "Reopened"


class Ticket(models.Model):
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="help_tickets"
    )
    # Who's working it, if anyone - set via the `assign` action. Unlike ESSL
    # (one hardcoded technician account), any employee holding help.manage can
    # be assigned, so this is a real FK rather than a free-text label.
    assigned_to = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_help_tickets",
    )
    subject = models.CharField(max_length=255)
    description = models.TextField(max_length=5000)
    category = models.CharField(max_length=32, choices=TicketCategory.choices)
    priority = models.CharField(
        max_length=10, choices=TicketPriority.choices, default=TicketPriority.MEDIUM
    )
    status = models.CharField(
        max_length=20, choices=TicketStatus.choices, default=TicketStatus.NEW
    )
    admin_comment = models.TextField(blank=True)
    # ESSL's escalation rule: escalation_level = min(reopen_count, 3).
    reopen_count = models.PositiveIntegerField(default=0)
    escalation_level = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.pk} {self.subject}"


class CategoryAssignment(models.Model):
    """Which employee owns a given category by default - e.g. IT & Access
    always routes to Priya, Food to Ravi. `TicketViewSet.perform_create`
    consults this to auto-assign a new ticket; the `assign` action still lets
    a helper override it (or pick it up manually for a category with no
    mapping configured). A category with no row here just stays unassigned,
    same as before this existed."""

    category = models.CharField(max_length=32, choices=TicketCategory.choices, unique=True)
    assignee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="help_category_assignments"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category"]

    def __str__(self):
        return f"{self.category} -> {self.assignee_id}"


class TicketActivity(models.Model):
    """Audit/comment trail - doubles as ESSL's activity timeline. No separate
    comment thread (ESSL doesn't have one either): every state change writes
    one row here."""

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        STATUS_UPDATED = "status-updated", "Status updated"
        REOPENED = "reopened", "Reopened"
        EDITED = "edited", "Edited"
        ASSIGNED = "assigned", "Assigned"

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="activities")
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    previous_status = models.CharField(
        max_length=20, choices=TicketStatus.choices, null=True, blank=True
    )
    new_status = models.CharField(
        max_length=20, choices=TicketStatus.choices, null=True, blank=True
    )
    comment = models.TextField(null=True, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
