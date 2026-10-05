"""Primitive #1 — the Employee/org table. See docs/ARCHITECTURE.md primitive 1.

Department, Location, and Legal Entity are the org dimensions the scope tiers in
core.scope dispatch on (alongside the manager self-FK, which backs the `manager`
and `team` tiers). JobTitle (formerly Designation) is descriptive org data with no scope tier of its
own. All four support models use is_active soft-delete — never hard-delete, since
historical Employee records may still reference a since-retired one.
"""

from django.conf import settings
from django.db import models

from core.enums import EmployeeStatus, EmploymentType, WorkMode


class SoftDeleteNamedModel(models.Model):
    """Shared shape for the small reference tables below: a unique name and an
    is_active flag instead of ever hard-deleting a row a historical Employee
    might still point to.

    `code` is the short finance/HR code for the row (e.g. "ENG", "G3") — it is
    indexed for lookups but deliberately NOT globally unique, since different
    entity types (and different legal entities) may reuse the same short code.
    `description` is free text shown on the admin screens."""

    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=30, blank=True, default="", db_index=True)
    description = models.TextField(blank=True, default="")
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
    head = models.ForeignKey(
        "Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_departments",
    )
    cost_center = models.ForeignKey(
        "CostCenter",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="departments",
    )
    business_unit = models.ForeignKey(
        "BusinessUnit",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="departments",
    )
    # Keka parity: distribution-list alias shown on the department screen.
    email_alias = models.CharField(max_length=150, blank=True, default="")


class JobTitle(SoftDeleteNamedModel):
    """A named role (e.g. "Backend Engineer") — descriptive org data with no
    scope tier of its own. Previously called Designation (renamed via an
    aliased migration that keeps every row); the Employee/Position field
    names (`designation`, `job_title`) and the read API shapes are unchanged
    so existing clients keep working."""

    job_family = models.ForeignKey(
        "JobFamily", null=True, blank=True, on_delete=models.SET_NULL, related_name="job_titles"
    )
    level = models.ForeignKey(
        "Level", null=True, blank=True, on_delete=models.SET_NULL, related_name="job_titles"
    )
    is_people_manager = models.BooleanField(default=False)


# Back-compat alias: JobTitle was renamed from Designation. The docstring above
# promises existing clients keep working, but the Python symbol was never
# aliased — so imports like `from employees.models import Designation`
# (timeline.py, tests) broke. Same model, same table.
Designation = JobTitle


class Location(SoftDeleteNamedModel):
    """A place of work. Address fields are informational (payroll owns
    statutory addresses later); `type` marks HQ vs branch vs remote."""

    TYPE_HQ = "hq"
    TYPE_BRANCH = "branch"
    TYPE_REMOTE = "remote"
    TYPE_CHOICES = [
        (TYPE_HQ, "Headquarters"),
        (TYPE_BRANCH, "Branch"),
        (TYPE_REMOTE, "Remote"),
    ]

    address_line1 = models.CharField(max_length=200, blank=True, default="")
    address_line2 = models.CharField(max_length=200, blank=True, default="")
    city = models.CharField(max_length=100, blank=True, default="")
    state = models.CharField(max_length=100, blank=True, default="")
    country = models.CharField(max_length=100, blank=True, default="")
    postal_code = models.CharField(max_length=20, blank=True, default="")
    timezone = models.CharField(max_length=50, blank=True, default="")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_BRANCH)
    # Keka parity: who runs this location + its distribution-list alias.
    location_head = models.ForeignKey(
        "Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_locations",
    )
    email_alias = models.CharField(max_length=150, blank=True, default="")


class LegalEntity(SoftDeleteNamedModel):
    """The company operates as a single legal entity today — exactly one row is
    seeded (see employees/migrations for the seed migration) — but this is a real
    table from day one so a second entity is a data change, not a schema change.

    Registration columns below are Keka parity (Registration Information tab).
    Tax/statutory filing columns stay in the payroll module
    (LegalEntityPayrollProfile) — nothing here FKs to payroll."""

    TYPE_LIMITED_LIABILITY = "limited_liability"
    TYPE_PRIVATE_LIMITED = "private_limited"
    TYPE_PUBLIC_LIMITED = "public_limited"
    TYPE_LLP = "llp"
    TYPE_PARTNERSHIP = "partnership"
    TYPE_SOLE_PROPRIETORSHIP = "sole_proprietorship"
    TYPE_OF_BUSINESS_CHOICES = [
        (TYPE_LIMITED_LIABILITY, "Limited Liability"),
        (TYPE_PRIVATE_LIMITED, "Private Limited"),
        (TYPE_PUBLIC_LIMITED, "Public Limited"),
        (TYPE_LLP, "LLP"),
        (TYPE_PARTNERSHIP, "Partnership"),
        (TYPE_SOLE_PROPRIETORSHIP, "Sole Proprietorship"),
    ]

    SECTOR_PROFESSIONALS = "professionals"
    SECTOR_MANUFACTURING = "manufacturing"
    SECTOR_IT_SOFTWARE = "it_software"
    SECTOR_SERVICES = "services"
    SECTOR_FINANCE = "finance"
    SECTOR_OTHER = "other"
    SECTOR_CHOICES = [
        (SECTOR_PROFESSIONALS, "Professionals"),
        (SECTOR_MANUFACTURING, "Manufacturing Industry"),
        (SECTOR_IT_SOFTWARE, "IT & Software"),
        (SECTOR_SERVICES, "Services"),
        (SECTOR_FINANCE, "Finance"),
        (SECTOR_OTHER, "Other"),
    ]

    FY_APR_MAR = "april_march"
    FY_JAN_DEC = "january_december"
    FY_JUL_JUN = "july_june"
    FINANCIAL_YEAR_CHOICES = [
        (FY_APR_MAR, "April - March"),
        (FY_JAN_DEC, "January - December"),
        (FY_JUL_JUN, "July - June"),
    ]

    legal_name = models.CharField(max_length=200, blank=True, default="")
    company_identification_number = models.CharField(max_length=50, blank=True, default="")
    date_of_incorporation = models.DateField(null=True, blank=True)
    type_of_business = models.CharField(
        max_length=30, choices=TYPE_OF_BUSINESS_CHOICES, blank=True, default=""
    )
    sector = models.CharField(max_length=30, choices=SECTOR_CHOICES, blank=True, default="")
    # Free text storing the Keka label incl. code, e.g.
    # 'Chartered Accountants, Auditors, etc. (601)'.
    nature_of_business = models.CharField(max_length=200, blank=True, default="")
    address_line1 = models.CharField(max_length=200, blank=True, default="")
    address_line2 = models.CharField(max_length=200, blank=True, default="")
    city = models.CharField(max_length=100, blank=True, default="")
    state = models.CharField(max_length=100, blank=True, default="")
    zip_code = models.CharField(max_length=20, blank=True, default="")
    financial_year = models.CharField(
        max_length=20, choices=FINANCIAL_YEAR_CHOICES, blank=True, default=""
    )
    registered_address = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    country = models.CharField(max_length=100, blank=True, default="")
    currency = models.CharField(max_length=10, default="INR")
    logo = models.URLField(max_length=500, blank=True, default="")


class BusinessUnit(SoftDeleteNamedModel):
    """A line of business or division that cuts across departments. `parent`
    builds the Division tier: a BusinessUnit with parent=None is a top-level
    unit, one with a parent is a Division inside it."""

    legal_entity = models.ForeignKey(
        LegalEntity,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="business_units",
    )
    head = models.ForeignKey(
        "Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_business_units",
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )


class CostCenter(SoftDeleteNamedModel):
    """A budget line employees are charged to. `code` comes from the shared
    base (the finance code); `owner` is whoever approves spend against it."""

    owner = models.ForeignKey(
        "Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="owned_cost_centers",
    )
    legal_entity = models.ForeignKey(
        LegalEntity,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cost_centers",
    )
    # Keka parity: distribution-list alias shown on the cost-center screen.
    email_alias = models.CharField(max_length=150, blank=True, default="")


class AuthorizedSignatory(models.Model):
    """A person authorised to sign for a legal entity (Keka inner tab
    "Authorized Signatories"). Informational only — deliberately NOT an FK to
    Employee, so non-employee directors/partners can be listed. Never
    hard-delete history: use is_active."""

    legal_entity = models.ForeignKey(
        LegalEntity, on_delete=models.CASCADE, related_name="authorized_signatories"
    )
    name = models.CharField(max_length=200)
    designation = models.CharField(max_length=150, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    din_or_pan = models.CharField(max_length=30, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.legal_entity_id})"


class LegalEntityBankAccount(models.Model):
    """A company bank account of a legal entity (Keka inner tab "Bank
    Details"). Named LegalEntityBankAccount (not BankDetails) because
    employees.BankDetails already means an employee's salary account.
    Never hard-delete history: use is_active."""

    ACCOUNT_SAVINGS = "savings"
    ACCOUNT_CURRENT = "current"
    ACCOUNT_TYPE_CHOICES = [
        (ACCOUNT_SAVINGS, "Savings"),
        (ACCOUNT_CURRENT, "Current"),
    ]

    legal_entity = models.ForeignKey(
        LegalEntity, on_delete=models.CASCADE, related_name="bank_accounts"
    )
    bank_name = models.CharField(max_length=150)
    account_number = models.CharField(max_length=34)
    ifsc_code = models.CharField(max_length=11)
    branch = models.CharField(max_length=150, blank=True, default="")
    account_type = models.CharField(
        max_length=20, choices=ACCOUNT_TYPE_CHOICES, blank=True, default=""
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["bank_name", "account_number"]

    def __str__(self):
        return f"{self.bank_name} …{self.account_number[-4:]} ({self.legal_entity_id})"


# NOTE (placeholder): PayGrade/Band below carry EXAMPLE fields only — the
# product owner has not shared the Keka Pay Grades / Bands screenshots yet.
# They are standalone reference tables with NO link to payroll by design.
# Revisit (rename/extend/drop) once the real screenshots land.


class PayGrade(models.Model):
    """EXAMPLE placeholder pay grade (e.g. E1, M2) with an indicative pay
    range. Money here is indicative only — real compensation lives in the
    payroll module, which does NOT point at this table."""

    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=30, blank=True, default="", db_index=True)
    description = models.TextField(blank=True, default="")
    min_pay = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    mid_pay = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    max_pay = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default="INR")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Band(models.Model):
    """EXAMPLE placeholder band (e.g. Individual Contributor, Manager) —
    optionally tied to a PayGrade. See PayGrade note above."""

    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=30, blank=True, default="", db_index=True)
    description = models.TextField(blank=True, default="")
    pay_grade = models.ForeignKey(
        PayGrade, null=True, blank=True, on_delete=models.SET_NULL, related_name="bands"
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


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
    reference table; positions point at level/grade, not at the family.
    `parent` groups families (e.g. "Technology" -> "Engineering")."""

    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )


class Level(SoftDeleteNamedModel):
    """A seniority rung (e.g. L1 Associate … L5 Principal) shared across
    families. Referenced by Position and directly by Employee. `rank` orders
    rungs numerically (higher = more senior); `job_family` scopes the rung
    to one family, or null when it is shared."""

    rank = models.IntegerField(default=0)
    job_family = models.ForeignKey(
        JobFamily, null=True, blank=True, on_delete=models.SET_NULL, related_name="levels"
    )


class Grade(SoftDeleteNamedModel):
    """A pay band (e.g. G1 … G4). Referenced by Position and directly by
    Employee. NO pay columns here — money lives in the payroll module, which
    links to Grade later."""

    level = models.ForeignKey(
        Level, null=True, blank=True, on_delete=models.SET_NULL, related_name="grades"
    )


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
        JobTitle, null=True, blank=True, on_delete=models.SET_NULL, related_name="positions"
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
        JobTitle, null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
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
    # Team membership is many-to-many: an employee can belong to several teams
    # (unlike department, which is a single FK). Org Structure > Team >
    # Employees > Add employees writes here. related_name="members".
    teams = models.ManyToManyField("Team", related_name="members", blank=True)
    status = models.CharField(
        max_length=20, choices=EmployeeStatus.choices, default=EmployeeStatus.ACTIVE
    )
    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    # Work arrangement (office/remote/hybrid). Not in the roster export, so it
    # defaults to OFFICE and HR sets remote/hybrid people from the employee form.
    work_mode = models.CharField(
        max_length=20, choices=WorkMode.choices, default=WorkMode.OFFICE
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


class EmployeeAddress(models.Model):
    """Current and permanent address for one employee. Personal data: readable
    with employees.personal.read (or by the person themselves), editable with
    employees.personal.write (or by the person themselves). When
    `permanent_same_as_current` is set the permanent_* columns are ignored and
    cleared, so the two can never disagree."""

    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="address")

    current_line1 = models.CharField(max_length=200, blank=True, default="")
    current_line2 = models.CharField(max_length=200, blank=True, default="")
    current_city = models.CharField(max_length=100, blank=True, default="")
    current_state = models.CharField(max_length=100, blank=True, default="")
    current_postal_code = models.CharField(max_length=12, blank=True, default="")
    current_country = models.CharField(max_length=100, blank=True, default="India")

    permanent_same_as_current = models.BooleanField(default=True)
    permanent_line1 = models.CharField(max_length=200, blank=True, default="")
    permanent_line2 = models.CharField(max_length=200, blank=True, default="")
    permanent_city = models.CharField(max_length=100, blank=True, default="")
    permanent_state = models.CharField(max_length=100, blank=True, default="")
    permanent_postal_code = models.CharField(max_length=12, blank=True, default="")
    permanent_country = models.CharField(max_length=100, blank=True, default="")

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Address for {self.employee_id}"


class EmergencyContact(models.Model):
    """Someone to call if something happens to the employee. Personal data,
    same access rules as EmployeeAddress."""

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="emergency_contacts"
    )
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=60)
    phone = models.CharField(max_length=30)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.name} ({self.relationship}) for {self.employee_id}"


class EmployeeAbout(models.Model):
    """The three free-text answers on a profile's About card. Self-expression,
    not sensitive: anyone who can open the profile reads it; the person (or HR)
    edits it. Blank means "not answered"."""

    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="about")
    about = models.TextField(blank=True, default="")
    love_about_job = models.TextField(blank=True, default="")
    interests = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"About for {self.employee_id}"


class EmployeeSkill(models.Model):
    """One skill a person lists on their profile. Names are unique per person,
    ignoring case (enforced in the serializer, since Django has no portable
    case-insensitive unique constraint on every database we run)."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="skills")
    name = models.CharField(max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.name} ({self.employee_id})"


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

class OrgSetting(models.Model):
    """A typed key/value org configuration row (e.g. onboarding defaults,
    directory display flags). `value` is free-form JSON; `category` groups
    keys for the settings screens. Read/written through get_setting /
    set_setting so callers never touch the table directly."""

    key = models.CharField(max_length=100, unique=True)
    value = models.JSONField(default=dict)
    category = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self):
        return self.key

    @classmethod
    def get_setting(cls, key, default=None):
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            return default

    @classmethod
    def set_setting(cls, key, value, category=""):
        row, _ = cls.objects.get_or_create(key=key, defaults={"value": value})
        row.value = value
        if category:
            row.category = category
        row.save(update_fields=["value", "category", "updated_at"])
        return row


class CodeScheme(models.Model):
    """How auto-generated codes for one entity type look (e.g. employees,
    departments, positions): prefix + separator + zero-padded sequence.
    next_code() renders the current code and advances the counter atomically
    (SELECT ... FOR UPDATE), so concurrent creators never collide."""

    entity_type = models.CharField(max_length=50, unique=True)
    prefix = models.CharField(max_length=20, blank=True, default="")
    padding = models.IntegerField(default=4)
    next_seq = models.IntegerField(default=1)
    separator = models.CharField(max_length=10, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["entity_type"]

    def __str__(self):
        return f"{self.entity_type} ({self.prefix}{self.separator}...)"

    def render(self, seq=None):
        seq = self.next_seq if seq is None else seq
        return f"{self.prefix}{self.separator}{str(seq).zfill(max(self.padding, 1))}"

    @classmethod
    def next_code(cls, entity_type):
        """Render the next code for `entity_type` and advance its counter.
        Creates a default scheme (prefix from the entity name) on first use."""
        from django.db import transaction

        with transaction.atomic():
            scheme, _ = cls.objects.select_for_update().get_or_create(
                entity_type=entity_type,
                defaults={"prefix": entity_type[:3].upper()},
            )
            if not scheme.is_active:
                raise ValueError(f"Code scheme for '{entity_type}' is inactive.")
            code = scheme.render()
            scheme.next_seq += 1
            scheme.save(update_fields=["next_seq", "updated_at"])
            return code


class HierarchyRule(models.Model):
    """One reporting-line constraint, e.g. "L2 Engineers must report to an
    L3+ inside their own department". A rule applies to an employee when every
    criterion it sets matches (an unset criterion is a wildcard); a rule with
    no criteria set applies to everyone. Inactive rules are ignored."""

    from_level = models.ForeignKey(
        Level, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    from_job_title = models.ForeignKey(
        JobTitle, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    must_report_to_level = models.ForeignKey(
        Level, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    same_department = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"HierarchyRule {self.pk} ({'active' if self.active else 'inactive'})"


def validate_manager(employee, manager=None):
    """Check `employee`'s manager against every active HierarchyRule.

    Returns a list of violation strings (empty = valid). `manager` defaults
    to the employee's current manager; pass an explicit candidate to
    pre-check a move. Only ids are read, so API serializers can validate a
    change before writing it."""

    manager = manager if manager is not None else getattr(employee, "manager", None)
    employee_level = getattr(employee, "level_id", None)
    employee_title = getattr(employee, "designation_id", None)
    employee_dept = getattr(employee, "department_id", None)
    errors = []
    for rule in HierarchyRule.objects.filter(active=True).order_by("id"):
        if rule.from_level_id is not None and rule.from_level_id != employee_level:
            continue
        if rule.from_job_title_id is not None and rule.from_job_title_id != employee_title:
            continue
        if manager is None:
            errors.append(f"Rule {rule.pk}: this role requires a manager.")
            continue
        want_level = rule.must_report_to_level
        if rule.must_report_to_level_id is not None and (
            getattr(manager, "level_id", None) != rule.must_report_to_level_id
        ):
            errors.append(
                f"Rule {rule.pk}: manager must be at level '{want_level.name}'."
                if want_level is not None
                else f"Rule {rule.pk}: manager is at the wrong level."
            )
        if rule.same_department and getattr(manager, "department_id", None) != employee_dept:
            errors.append(f"Rule {rule.pk}: manager must be in the same department.")
    return errors


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


class CustomReport(models.Model):
    """A saved custom report built in the Employee Reports wizard: a base
    report type plus the picked column keys and the filter values active at
    save time. Personal to its owner — the list view only shows the caller's
    own rows. `base_type` is validated against the reports engine's registry
    at write time (no DB choices, so new report types never need a schema
    migration); `selected_fields` must be known field keys."""

    name = models.CharField(max_length=150)
    base_type = models.CharField(max_length=60)
    selected_fields = models.JSONField(default=list)
    filters = models.JSONField(default=dict)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="custom_reports"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "name"], name="unique_custom_report_name_per_owner"
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.base_type})"


class EmployeeRosterInfo(models.Model):
    """Roster-export attributes (Keka "EE & Reporting") that have no first-class
    home on Employee: dotted-line / L2 manager, attendance setup and the raw
    worker/time type labels. Filled by ``import_roster``; read by the Employee
    Reports engine so the "EE & Reporting" report and custom reports can show
    the original roster values. Blank means the roster had no value."""

    employee = models.OneToOneField(
        Employee, on_delete=models.CASCADE, related_name="roster_info"
    )
    employment_status = models.CharField(max_length=40, blank=True, default="")
    dotted_line_manager = models.CharField(max_length=200, blank=True, default="")
    reporting_manager_email = models.EmailField(blank=True, default="")
    l2_manager = models.CharField(max_length=200, blank=True, default="")
    worker_type = models.CharField(max_length=40, blank=True, default="")
    time_type = models.CharField(max_length=40, blank=True, default="")
    attendance_number = models.CharField(max_length=50, blank=True, default="")
    attendance_capture_scheme = models.CharField(max_length=100, blank=True, default="")
    attendance_tracking_policy = models.CharField(max_length=100, blank=True, default="")
    exit_status = models.CharField(max_length=60, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Roster info for {self.employee_id}"
