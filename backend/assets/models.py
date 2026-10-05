"""Asset Management module — company asset inventory (laptops today).

The assignee link is `assigned_to` (spec naming). `employee_id` below is a
read-only alias so core.permissions.ScopedEmployeePermission — which
scope-checks every record through `obj.employee_id` — keeps working without
a new RBAC engine.
"""

from django.db import models


class Asset(models.Model):
    """One company-owned asset. `asset_tag` is the LAPTOP NAME from the HR
    export (e.g. 4AT-L001) and is the idempotency key for import_assets."""

    STATUS_ASSIGNED = "assigned"
    STATUS_AVAILABLE = "available"
    STATUS_RECOVERED = "recovered"

    asset_tag = models.CharField(max_length=50, unique=True, db_index=True)
    category = models.CharField(max_length=50, default="laptop")
    brand = models.CharField(max_length=100, blank=True, default="")
    serial = models.CharField(max_length=100, blank=True, default="")
    processor = models.CharField(max_length=100, blank=True, default="")
    ram = models.CharField(max_length=100, blank=True, default="")
    date_of_allotment = models.DateField(null=True, blank=True)
    date_of_recover = models.DateField(null=True, blank=True)
    has_bag = models.BooleanField(default=False)
    previously_used = models.TextField(blank=True, default="")
    assigned_to = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assets",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["asset_tag"]
        indexes = [models.Index(fields=["assigned_to"])]

    def __str__(self):
        return f"{self.asset_tag}"

    @property
    def employee_id(self):
        """Alias for ScopedEmployeePermission's object check (see module
        docstring)."""
        return self.assigned_to_id

    @property
    def status(self):
        if self.assigned_to_id is not None:
            return self.STATUS_ASSIGNED
        if self.date_of_recover is not None:
            return self.STATUS_RECOVERED
        return self.STATUS_AVAILABLE
