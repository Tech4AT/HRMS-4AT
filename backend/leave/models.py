"""PLAN.md Step 4. LeaveType/LeaveBalance/LeaveRequest — see leave/conflicts.py
for how a leave request interacts with Attendance's WFH/Regularisation and
with Attendance's week-off/holiday overlays, and leave/handlers.py for how a
decision from the approvals engine applies to a balance."""

from django.db import models


class LeaveCategory(models.TextChoices):
    # Values match the frontend's CATEGORY_OPTIONS verbatim (LeaveSettingsPanel.tsx)
    # — the frontend sends/displays these strings directly, not a separate code.
    REGULAR = "Regular", "Regular"
    COMPENSATORY_OFFS = "Compensatory offs", "Compensatory offs"
    UNPAID = "Unpaid", "Unpaid"
    INCIDENT_BASED = "Incident based", "Incident based"


class LeaveTypeStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class LeaveType(models.Model):
    """`code` is never sent by the frontend (LeaveTypeInput has no `code`
    field) — it's auto-derived from `name`, matching the retired mock
    backend's exact rule (`name.slice(0,3).toUpperCase()`), with a numeric
    suffix if that collides with an existing type."""

    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=12, unique=True, editable=False)
    category = models.CharField(
        max_length=30, choices=LeaveCategory.choices, default=LeaveCategory.REGULAR
    )
    annual_allocation = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    carry_forward_limit = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    requires_approval = models.BooleanField(default=True)
    is_paid = models.BooleanField(default=True)
    description = models.TextField(blank=True, null=True, default=None)
    # Never set by the frontend (no control for it anywhere in
    # LeaveSettingsPanel.tsx) — kept for contract parity, always "active".
    status = models.CharField(
        max_length=20, choices=LeaveTypeStatus.choices, default=LeaveTypeStatus.ACTIVE
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.code:
            base = "".join(ch for ch in self.name.upper() if ch.isalnum())[:3] or "LVE"
            code, suffix = base, 2
            while LeaveType.objects.filter(code=code).exclude(pk=self.pk).exists():
                code = f"{base}{suffix}"
                suffix += 1
            self.code = code
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.code})"


class LeaveBalance(models.Model):
    """One row per employee per leave type per financial year. `financial_year`
    is a plain calendar-year string (e.g. "2026") — matches the retired mock
    backend's exact format; no April-March fiscal-year offset is assumed.

    Rows are lazily created (leave/views.py) the first time an employee's
    balance for a type/year is referenced, seeded from the type's current
    `annual_allocation` — proration for a mid-year joiner, accrual over the
    year, and carry-forward computation at a year boundary are all PLAN.md
    Step 7's job, not this one; this model exists now because LeaveRequest
    needs somewhere real to deduct from today."""

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="leave_balances"
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="balances")
    financial_year = models.CharField(max_length=4)
    opening_balance = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    allocated = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    used = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    pending = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    carry_forward = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    lapsed = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["leave_type__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "leave_type", "financial_year"],
                name="unique_leave_balance_per_employee_type_year",
            )
        ]

    @property
    def entitled(self):
        return self.opening_balance + self.allocated + self.carry_forward

    @property
    def available(self):
        return self.entitled - self.used - self.pending - self.lapsed

    def __str__(self):
        return f"{self.employee_id}/{self.leave_type_id}/{self.financial_year}"


class HalfDayOption(models.TextChoices):
    FULL_DAY = "full_day", "Full day"
    FIRST_HALF = "first_half", "First half"
    SECOND_HALF = "second_half", "Second half"


class LeaveRequestStatus(models.TextChoices):
    # DRAFT exists in the frontend's LeaveStatus type but no UI flow ever
    # produces it (grep confirms no "draft" anywhere in leave/page.tsx) —
    # kept for contract parity, never set by this app.
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class LeaveRequest(models.Model):
    """No `approver` field, no approve/reject action — mirrors
    attendance.AttendanceRequest exactly. `approval_request` links to the one
    `approvals.Request` row that gets decided when `leave_type.requires_approval`
    is True; it stays null for an auto-approved request, since none is ever
    raised for those (leave/views.py, leave/rbac.py's module docstring)."""

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="leave_requests"
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    half_day_option = models.CharField(
        max_length=20, choices=HalfDayOption.choices, default=HalfDayOption.FULL_DAY
    )
    reason = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=20, choices=LeaveRequestStatus.choices, default=LeaveRequestStatus.SUBMITTED
    )
    # Computed once at creation (leave/conflicts.py) and stored — later
    # changes to holiday/week-off configuration must not retroactively change
    # how much balance an already-raised request draws.
    duration_days = models.DecimalField(max_digits=5, decimal_places=1)
    financial_year = models.CharField(max_length=4)
    approval_request = models.ForeignKey(
        "approvals.Request", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.leave_type_id} [{self.status}] for {self.employee_id}"
