"""PLAN.md Step 3. AttendanceRecord/BreakSession back self-service check-in/out
and break tracking (`lib/api/attendance.ts`'s AttendanceRecord/AttendanceDayView).
AttendanceRequest backs WFH/regularisation requests, raised through the
approvals engine (see handlers.py) rather than carrying its own approver/
approve-action — `approval_request` links back to the one `approvals.Request`
row that actually gets decided; this app never decides one itself."""

from django.db import models
from django.utils import timezone


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Present"
    WORK_FROM_HOME = "work_from_home", "Work From Home"
    HALF_DAY = "half_day", "Half Day"
    ABSENT = "absent", "Absent"
    NOT_MARKED = "not_marked", "Not Marked"


class AttendanceSource(models.TextChoices):
    SELF = "self", "Self check-in"
    REGULARIZATION = "regularization", "Regularisation"
    ADMIN = "admin", "Marked by admin"


class AttendanceRecord(models.Model):
    """One row per employee per calendar date. `status` reflects only what this
    record itself asserts (checked in, or set by an approved WFH/regularisation
    request) — the day-and-a-half/holiday/weekend/leave overlay the frontend's
    AttendanceDayView also shows is computed at read time (views.py), not stored
    here. late/early_leave/overtime minutes need an assigned Shift to compute
    against (PLAN.md Step 6, not yet built) — left null until then."""

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="attendance_records"
    )
    attendance_date = models.DateField()
    clock_in_time = models.DateTimeField(null=True, blank=True)
    clock_out_time = models.DateTimeField(null=True, blank=True)
    working_minutes = models.PositiveIntegerField(null=True, blank=True)
    late_minutes = models.PositiveIntegerField(null=True, blank=True)
    early_leave_minutes = models.PositiveIntegerField(null=True, blank=True)
    overtime_minutes = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=AttendanceStatus.choices, default=AttendanceStatus.NOT_MARKED
    )
    source = models.CharField(
        max_length=20, choices=AttendanceSource.choices, default=AttendanceSource.SELF
    )
    notes = models.TextField(blank=True)
    marked_by = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-attendance_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "attendance_date"], name="unique_attendance_record_per_day"
            )
        ]

    def __str__(self):
        return f"{self.employee_id} @ {self.attendance_date} ({self.status})"


class BreakSession(models.Model):
    """A single break within one AttendanceRecord's day. `end_time` null means
    the break is currently in progress — backs AttendanceDayView.on_break."""

    attendance_record = models.ForeignKey(
        AttendanceRecord, on_delete=models.CASCADE, related_name="breaks"
    )
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["start_time"]

    @property
    def minutes(self) -> int:
        end = self.end_time or timezone.now()
        return max(0, int((end - self.start_time).total_seconds() // 60))


class AttendanceRequestType(models.TextChoices):
    WFH = "wfh", "Work From Home"
    REGULARISATION = "regularisation", "Regularisation"


class AttendanceRequestStatus(models.TextChoices):
    SUBMITTED = "submitted", "Submitted"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class AttendanceRequest(models.Model):
    """WFH or regularisation request. No `approver` field and no approve/reject
    action on this model on purpose (PLAN.md Step 3/5): the request is raised
    via approvals.create_request() (handlers.py) and `approval_request` links to
    the one `approvals.Request` row a manager actually decides through the
    generic engine. `status` here is a mirror, kept in sync by this app's
    `request_decided` receiver — never set directly by this app outside that
    receiver and the initial `submitted` default."""

    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="attendance_requests"
    )
    request_type = models.CharField(max_length=20, choices=AttendanceRequestType.choices)
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=20,
        choices=AttendanceRequestStatus.choices,
        default=AttendanceRequestStatus.SUBMITTED,
    )
    approval_request = models.ForeignKey(
        "approvals.Request", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.request_type} [{self.status}] for {self.employee_id}"
