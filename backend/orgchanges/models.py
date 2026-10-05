"""Effective-dated organisation changes (promotions, transfers, …).

An OrgChange is a promise that becomes real on `effective_date`: while it is
`pending` the employee row is untouched, and the `apply_due_org_changes`
management command flips due rows to `effective` and writes the change onto
the employee. Cancelling is a PATCH to `cancelled`; `effective` rows are
history and never edited.
"""

from django.conf import settings
from django.db import models


class OrgChange(models.Model):
    TYPE_PROMOTION = "promotion"
    TYPE_DEPT_TRANSFER = "dept_transfer"
    TYPE_LOCATION_TRANSFER = "location_transfer"
    TYPE_POSITION_CHANGE = "position_change"
    TYPE_MANAGER_CHANGE = "manager_change"
    TYPE_CHOICES = [
        (TYPE_PROMOTION, "Promotion"),
        (TYPE_DEPT_TRANSFER, "Department transfer"),
        (TYPE_LOCATION_TRANSFER, "Location transfer"),
        (TYPE_POSITION_CHANGE, "Position change"),
        (TYPE_MANAGER_CHANGE, "Manager change"),
    ]

    STATUS_PENDING = "pending"
    STATUS_EFFECTIVE = "effective"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_EFFECTIVE, "Effective"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="org_changes"
    )
    change_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    # Flexible from/to payloads: {"department_id": "3"}, {"manager_id": "9"},
    # {"designation_id": .., "level_id": .., "grade_id": ..} for promotions —
    # whatever the change type needs, resolved when the change is applied.
    from_data = models.JSONField(default=dict, blank=True)
    to_data = models.JSONField(default=dict, blank=True)
    effective_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-effective_date", "-created_at"]

    def __str__(self):
        return f"{self.get_change_type_display()} for {self.employee_id} ({self.status})"
