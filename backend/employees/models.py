"""Primitive #1 — the Employee/org table. See docs/ARCHITECTURE.md primitive 1.

Department, Location, and Legal Entity are the org dimensions the scope tiers in
core.scope dispatch on (alongside the manager self-FK, which backs the `manager`
and `team` tiers). Designation is descriptive org data with no scope tier of its
own. All four support models use is_active soft-delete — never hard-delete, since
historical Employee records may still reference a since-retired one.
"""

from django.conf import settings
from django.db import models

from core.enums import EmployeeStatus, EmploymentType


class SoftDeleteNamedModel(models.Model):
    """Shared shape for the small reference tables below: a unique name and an
    is_active flag instead of ever hard-deleting a row a historical Employee
    might still point to."""

    name = models.CharField(max_length=150, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["name"]

    def __str__(self):
        return self.name


class Department(SoftDeleteNamedModel):
    """Two-level in practice (e.g. "Audit & Assurance" -> "InfoSec Audit") —
    `parent` is nullable so a top-level department (or one with no
    sub-department) is just a Department with parent=None."""

    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )


class Designation(SoftDeleteNamedModel):
    pass


class Location(SoftDeleteNamedModel):
    pass


class LegalEntity(SoftDeleteNamedModel):
    """The company operates as a single legal entity today — exactly one row is
    seeded (see employees/migrations for the seed migration) — but this is a real
    table from day one so a second entity is a data change, not a schema change."""


class BusinessUnit(SoftDeleteNamedModel):
    """A line of business or division that cuts across departments."""


class CostCenter(SoftDeleteNamedModel):
    """A budget line employees are charged to. `code` is the finance code."""

    code = models.CharField(max_length=30, blank=True)


class Team(SoftDeleteNamedModel):
    """A working group inside a department (docx treats Teams as distinct
    below Dept). `lead` is whoever runs the team day-to-day — nullable since
    a team can exist before a lead is named."""

    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.PROTECT, related_name="teams"
    )
    lead = models.ForeignKey(
        "Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="led_teams"
    )


class JobFamily(SoftDeleteNamedModel):
    """A broad occupation group (e.g. Engineering, Design) — a standalone
    reference table; positions point at level/grade, not at the family."""


class Level(SoftDeleteNamedModel):
    """A seniority rung (e.g. L1 Associate … L5 Principal) shared across
    families. Referenced by Position and directly by Employee."""


class Grade(SoftDeleteNamedModel):
    """A pay band (e.g. G1 … G4). Referenced by Position and directly by
    Employee."""


class Position(models.Model):
    """An approved seat, independent of any employee — it exists whether
    filled or vacant. The incumbent link is the current holder; clearing it
    (plus status back to vacant) is what "the seat is empty" means."""

    STATUS_FILLED = "filled"
    STATUS_VACANT = "vacant"
    STATUS_HIRING = "hiring"
    STATUS_ON_HOLD = "on_hold"
    STATUS_CHOICES = [
        (STATUS_FILLED, "Filled"),
        (STATUS_VACANT, "Vacant"),
        (STATUS_HIRING, "Hiring"),
        (STATUS_ON_HOLD, "On hold"),
    ]

    name = models.CharField(max_length=150, blank=True, default="")
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="positions"
    )
    job_title = models.ForeignKey(
        Designation, null=True, blank=True, on_delete=models.SET_NULL, related_name="positions"
    )
    level = models.ForeignKey(
        Level, null=True, blank=True, on_delete=models.SET_NULL, related_name="positions"
    )
    grade = models.ForeignKey(
        Grade, null=True, blank=True, on_delete=models.SET_NULL, related_name="positions"
    )
    business_unit = models.ForeignKey(
        BusinessUnit,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="positions",
    )
    reports_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="direct_reports",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_VACANT)
    incumbent = models.ForeignKey(
        "Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="held_positions",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name or f"Position {self.pk}"


class Employee(models.Model):
    """The one model every other module in the system references. `manager` is
    the self-referencing FK the `manager` (direct reports) and `team` (full
    transitive subtree) scope tiers resolve against; `department`/`location`/
    `legal_entity` back their respective tiers. All three are nullable since an
    employee can exist before every dimension is assigned."""

    # Status values the teammate's onboarding module reads/writes. Ours only
    # enumerates active/on_leave/exited (see core.enums.EmployeeStatus); the
    # extra values are carried as plain strings (Django does not enforce
    # choices on save) so his create/update paths work unchanged.
    STATUS_PRE_ONBOARDING = "pre_onboarding"
    STATUS_ACTIVE = "active"
    STATUS_ON_LEAVE = "on_leave"
    STATUS_EXITED = "exited"
    STATUS_OFFER_DECLINED = "offer_declined"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="employee"
    )
    manager = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="direct_reports",
    )
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    designation = models.ForeignKey(
        Designation, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    location = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    legal_entity = models.ForeignKey(
        LegalEntity, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    business_unit = models.ForeignKey(
        BusinessUnit, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    cost_center = models.ForeignKey(
        CostCenter, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    # ORG Wave 1 additive FKs (all nullable — existing rows are untouched).
    position = models.ForeignKey(
        Position, null=True, blank=True, on_delete=models.SET_NULL, related_name="holders"
    )
    level = models.ForeignKey(
        Level, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    grade = models.ForeignKey(
        Grade, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    status = models.CharField(
        max_length=20, choices=EmployeeStatus.choices, default=EmployeeStatus.ACTIVE
    )
    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    employee_code = models.CharField(max_length=50, unique=True)

    # Lifecycle. date_of_exit and exit_reason are set when status becomes
    # `exited` and cleared if the person returns.
    date_of_joining = models.DateField(null=True, blank=True)
    date_of_exit = models.DateField(null=True, blank=True)
    exit_reason = models.CharField(max_length=200, blank=True)

    # Personal details. Not part of the ordinary directory: readable only with
    # employees.personal.read, editable by the person themselves (self-service)
    # or with employees.personal.write.
    personal_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    dob = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=20, blank=True)

    # Onboarding hybrid compat columns (all nullable/additive — existing rows
    # are untouched). The teammate's onboarding module keeps the hire's name,
    # work email and joining date on the Employee row itself, while our base
    # keeps names on the linked User and the joining date in date_of_joining.
    # save() below mirrors the two sides when only one is filled so they
    # cannot silently diverge.
    first_name = models.CharField(max_length=150, blank=True, default="")
    last_name = models.CharField(max_length=150, blank=True, default="")
    work_email = models.EmailField(null=True, blank=True, unique=True)
    joining_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_code"]

    def __str__(self):
        return f"{self.employee_code} ({self.user.get_username()})"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def save(self, *args, **kwargs):
        """Empty-fill mirrors for the onboarding compat columns. Only fills a
        side that is empty from the other side — never overwrites a value that
        is already set, so existing write paths are unaffected."""
        user = getattr(self, "user", None)
        if user is not None and getattr(user, "pk", None) is not None:
            if not self.first_name and getattr(user, "first_name", ""):
                self.first_name = user.first_name
            if not self.last_name and getattr(user, "last_name", ""):
                self.last_name = user.last_name
            if not self.work_email and getattr(user, "email", ""):
                self.work_email = user.email
        if self.joining_date is None and self.date_of_joining is not None:
            self.joining_date = self.date_of_joining
        elif self.date_of_joining is None and self.joining_date is not None:
            self.date_of_joining = self.joining_date
        super().save(*args, **kwargs)


def _mask(value: str) -> str:
    """All but the last 4 characters replaced with '•' — same convention
    for account numbers and identity document numbers."""
    if len(value) <= 4:
        return value
    return "•" * (len(value) - 4) + value[-4:]


def next_employee_code() -> str:
    """Sequential, zero-padded 'EMPnnnn' codes (EMP0001, EMP0002, ...) —
    derived from the highest existing numeric suffix rather than a counter
    table, so it stays correct even if rows are seeded out of order."""
    last = Employee.objects.order_by("-id").values_list("employee_code", flat=True).first()
    n = 0
    if last and last.startswith("EMP"):
        try:
            n = int(last[3:])
        except ValueError:
            n = Employee.objects.count()
    else:
        n = Employee.objects.count()
    return f"EMP{n + 1:04d}"


class BankDetails(models.Model):
    """Bank account for salary credit, captured during preboarding. Same
    security tier as IdentityDocument: the number is masked by default
    wherever HR/finance view it; revealing it is an explicit, audited action
    (see onboarding/views.py). Additive model for the onboarding hybrid
    layer — no existing table is touched."""

    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="bank_details")
    account_holder_name = models.CharField(max_length=200)
    account_number = models.CharField(max_length=34)
    ifsc_code = models.CharField(max_length=11, blank=True, default="")
    bank_name = models.CharField(max_length=150, blank=True, default="")
    branch_name = models.CharField(max_length=150, blank=True, default="")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Bank details for {self.employee_id}"

    @property
    def masked_account_number(self) -> str:
        return _mask(self.account_number)


class IdentityDocument(models.Model):
    """A structured identity document submitted during preboarding — the
    uploaded file (documents.Document) *plus* the data typed off it (number,
    name, DOB, address...). The candidate types these fields themselves;
    nothing here claims the data is verified until HR explicitly marks it so.
    Additive model for the onboarding hybrid layer."""

    TYPE_AADHAAR = "aadhaar"
    TYPE_PAN = "pan"
    TYPE_VOTER_ID = "voter_id"
    TYPE_PASSPORT = "passport"
    TYPE_DRIVING_LICENSE = "driving_license"
    TYPE_OTHER = "other"
    TYPE_CHOICES = [
        (TYPE_AADHAAR, "Aadhaar Card"),
        (TYPE_PAN, "PAN Card"),
        (TYPE_VOTER_ID, "Voter ID"),
        (TYPE_PASSPORT, "Passport"),
        (TYPE_DRIVING_LICENSE, "Driving License"),
        (TYPE_OTHER, "Other"),
    ]

    VERIFICATION_PENDING = "pending"
    VERIFICATION_VERIFIED = "verified"
    VERIFICATION_REJECTED = "rejected"
    VERIFICATION_STATUS_CHOICES = [
        (VERIFICATION_PENDING, "Pending verification"),
        (VERIFICATION_VERIFIED, "Verified"),
        (VERIFICATION_REJECTED, "Rejected"),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="identity_documents"
    )
    document_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    document_number = models.CharField(max_length=64)
    full_name = models.CharField(max_length=200, blank=True, default="")
    date_of_birth = models.DateField(null=True, blank=True)
    address = models.TextField(blank=True, default="")
    gender = models.CharField(max_length=20, blank=True, default="")
    parent_or_guardian_name = models.CharField(max_length=200, blank=True, default="")
    expiry_date = models.DateField(null=True, blank=True)

    verification_status = models.CharField(
        max_length=20, choices=VERIFICATION_STATUS_CHOICES, default=VERIFICATION_PENDING
    )
    verification_notes = models.TextField(blank=True, default="")
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_document_type_display()} for {self.employee_id} ({self.verification_status})"

    @property
    def is_expired(self) -> bool:
        if not self.expiry_date:
            return False
        from django.utils import timezone

        return self.expiry_date < timezone.now().date()

    @property
    def masked_document_number(self) -> str:
        return _mask(self.document_number)


class EducationRecord(models.Model):
    """A degree/certificate submitted during preboarding, with HR
    verification state. Additive model for the onboarding hybrid layer."""

    VERIFICATION_PENDING = "pending"
    VERIFICATION_VERIFIED = "verified"
    VERIFICATION_REJECTED = "rejected"
    VERIFICATION_STATUS_CHOICES = [
        (VERIFICATION_PENDING, "Pending verification"),
        (VERIFICATION_VERIFIED, "Verified"),
        (VERIFICATION_REJECTED, "Rejected"),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="education_records"
    )
    degree = models.CharField(max_length=150)
    branch = models.CharField(max_length=150, blank=True, default="")
    university = models.CharField(max_length=200, blank=True, default="")
    year_of_joining = models.PositiveSmallIntegerField(null=True, blank=True)
    year_of_completion = models.PositiveSmallIntegerField(null=True, blank=True)
    grade = models.CharField(max_length=20, blank=True, default="")
    verification_status = models.CharField(
        max_length=20, choices=VERIFICATION_STATUS_CHOICES, default=VERIFICATION_PENDING
    )
    verification_notes = models.TextField(blank=True, default="")
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.degree} for {self.employee_id} ({self.verification_status})"


class EmployeeLetter(models.Model):
    """An HR-issued letter (appointment, appraisal, promotion, other) filed
    against an employee during onboarding. Additive model for the onboarding
    hybrid layer."""

    TYPE_APPOINTMENT = "appointment"
    TYPE_APPRAISAL = "appraisal"
    TYPE_PROMOTION = "promotion"
    TYPE_OTHER = "other"
    TYPE_CHOICES = [
        (TYPE_APPOINTMENT, "Appointment Letter"),
        (TYPE_APPRAISAL, "Appraisal Letter"),
        (TYPE_PROMOTION, "Promotion Letter"),
        (TYPE_OTHER, "Other"),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="employee_letters"
    )
    letter_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    title = models.CharField(max_length=200)
    issued_date = models.DateField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} for {self.employee_id}"

class Resignation(models.Model):
    STATUS_SUBMITTED = "submitted"
    STATUS_ACCEPTED = "accepted"
    STATUS_REJECTED = "rejected"
    STATUS_WITHDRAWN = "withdrawn"
    STATUS_COMPLETED = "completed"
    STATUS_CHOICES = [
        (STATUS_SUBMITTED, "Awaiting HR review"),
        (STATUS_ACCEPTED, "Accepted — serving notice"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_WITHDRAWN, "Withdrawn"),
        (STATUS_COMPLETED, "Exited"),
    ]
    OPEN_STATUSES = (STATUS_SUBMITTED, STATUS_ACCEPTED)

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="resignations")
    reason = models.TextField()
    requested_last_day = models.DateField()
    last_working_day = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SUBMITTED)
    initiated_by_hr = models.BooleanField(default=False)
    hr_notes = models.TextField(blank=True, default="")
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee"],
                condition=models.Q(status__in=["submitted", "accepted"]),
                name="one_open_resignation_per_employee",
            ),
        ]

    def __str__(self):
        return f"Resignation {self.employee_id} ({self.status})"
