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
    here. late/early_leave/overtime minutes are computed against the employee's
    assigned Shift at check-in/check-out time (see timing.py) — null for an
    employee with no Shift assigned, since there's nothing to compare against."""

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


class Shift(models.Model):
    """PLAN.md Step 6. Matches `lib/attendance/shifts.ts`'s `Shift` shape
    exactly (`name`, `startTime`, `endTime`, `breakMinutes`, `employeeIds`) —
    there's no existing wire contract to match here (that file is still
    frontend-only local state, no API client yet), so this app's normal
    snake_case + the project's default CamelCase renderer produce the exact
    field names the frontend already uses, with no translation layer needed
    once a client is wired up (Step 11).

    `employees` is a plain M2M, not a FK from Employee — nothing in the
    frontend enforces "one shift per employee" either (the assignment modal
    doesn't check whether someone is already on another shift), and adding a
    FK the other way would mean editing `employees.Employee`, which is off
    limits (PLAN.md §0). The M2M's through-table lives entirely in this app's
    own migrations."""

    name = models.CharField(max_length=100, unique=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    break_minutes = models.PositiveIntegerField(default=0)
    employees = models.ManyToManyField("employees.Employee", related_name="shifts", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PolicySettings(models.Model):
    """PLAN.md Step 6. A single row (enforced by `PolicySettings.load()` below,
    not a DB constraint — matches `RecurringWfhRule`-style admin config, just
    with exactly one row instead of one per weekday). Matches
    `lib/attendance/penalisation.ts`'s `PolicizationSettings` shape — flat
    fields here, nested in the API response (see `settings_serializers.py`)
    since the frontend groups them as `noAttendance: {enabled,
    leaveDaysDeducted}` etc., not flat `noAttendanceEnabled`.

    Only the settings themselves live here — the actual per-employee
    `PenalisationRecord` and its auto-apply/overturn lifecycle are PLAN.md
    Step 8, not this one."""

    regularisation_grace_days = models.PositiveIntegerField(default=3)
    absconding_threshold_days = models.PositiveIntegerField(default=5)

    no_attendance_enabled = models.BooleanField(default=True)
    no_attendance_leave_days_deducted = models.DecimalField(
        max_digits=4, decimal_places=1, default=1
    )

    late_arrival_enabled = models.BooleanField(default=False)
    late_arrival_leave_days_deducted = models.DecimalField(
        max_digits=4, decimal_places=1, default=0.5
    )
    late_arrival_threshold_count = models.PositiveIntegerField(default=3)

    early_leaving_enabled = models.BooleanField(default=False)
    early_leaving_leave_days_deducted = models.DecimalField(
        max_digits=4, decimal_places=1, default=0.5
    )
    early_leaving_threshold_count = models.PositiveIntegerField(default=3)

    work_hours_enabled = models.BooleanField(default=False)
    work_hours_leave_days_deducted = models.DecimalField(
        max_digits=4, decimal_places=1, default=0.5
    )
    work_hours_min_work_hours = models.DecimalField(max_digits=4, decimal_places=1, default=8)

    comp_off_accrual_enabled = models.BooleanField(default=True)
    comp_off_accrual_overtime_hours_per_comp_off = models.DecimalField(
        max_digits=5, decimal_places=1, default=8
    )

    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls) -> "PolicySettings":
        """The one row, created with defaults on first access. Every view goes
        through this rather than a bare `.objects.get()`/`.first()`, so
        nothing has to separately handle "no settings configured yet"."""
        obj, _created = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return "Policy Settings"
