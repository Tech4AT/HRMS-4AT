import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

# Integrated with the core: the company legal entity is employees.LegalEntity
# (single source of truth). Payroll-specific registration details hang off it
# via a OneToOne profile instead of a duplicate LegalEntity model. Employee-
# owned rows link to employees.Employee through an `employee` FK so the core's
# ScopedEmployeePermission / resolve_employee_scope can scope them.


class LegalEntityPayrollProfile(models.Model):
    """Payroll registration details for a core LegalEntity (PAN/TAN/GSTIN…)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    legal_entity = models.OneToOneField(
        "employees.LegalEntity", on_delete=models.CASCADE, related_name="payroll_profile"
    )
    pan = models.CharField(max_length=10, unique=True)
    tan = models.CharField(max_length=10, blank=True, null=True)
    gstin = models.CharField(max_length=15, blank=True, null=True)
    state = models.CharField(max_length=2)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Payroll profile - {self.legal_entity.name}"


class PaySchedule(models.Model):
    FREQUENCY_CHOICES = [
        ("weekly", "Weekly"),
        ("biweekly", "Bi-weekly"),
        ("semimonthly", "Semi-monthly"),
        ("monthly", "Monthly"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    pay_period_start_day = models.IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    cutoff_day = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(31)])
    pay_date_offset_days = models.IntegerField(default=3)
    first_cycle_start_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class StatutoryConfig(models.Model):
    CONTRIBUTION_TYPE_CHOICES = [
        ("PF", "Provident Fund"),
        ("ESI", "Employee State Insurance"),
        ("LWF", "Labor Welfare Fund"),
        ("PROFESSIONAL_TAX", "Professional Tax"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    legal_entity = models.ForeignKey(
        "employees.LegalEntity", on_delete=models.CASCADE, related_name="statutory_configs"
    )
    contribution_type = models.CharField(max_length=20, choices=CONTRIBUTION_TYPE_CHOICES)
    is_enabled = models.BooleanField(default=True)
    registration_number = models.CharField(max_length=50)
    effective_date = models.DateField()
    signatory_name = models.CharField(max_length=255)
    signatory_designation = models.CharField(max_length=100)
    signatory_pan = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("legal_entity", "contribution_type")
        verbose_name_plural = "Statutory Configs"
        ordering = ["legal_entity", "contribution_type"]

    def __str__(self):
        return f"{self.legal_entity.name} - {self.get_contribution_type_display()}"


class TaxFilingConfig(models.Model):
    FILING_FREQUENCY_CHOICES = [
        ("quarterly", "Quarterly"),
        ("half_yearly", "Half Yearly"),
        ("annual", "Annual"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    legal_entity = models.OneToOneField(
        "employees.LegalEntity", on_delete=models.CASCADE, related_name="tax_filing_config"
    )
    filing_frequency = models.CharField(max_length=20, choices=FILING_FREQUENCY_CHOICES)
    state_tax_id = models.CharField(max_length=50, blank=True, null=True)
    federal_tax_id = models.CharField(max_length=50, blank=True, null=True)
    effective_from = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Tax Filing Configs"

    def __str__(self):
        return f"Tax Filing - {self.legal_entity.name}"


class PayStubTemplate(models.Model):
    APPLIES_TO_CHOICES = [("employee", "Employee"), ("contractor", "Contractor")]
    DELIVERY_METHOD_CHOICES = [("email", "Email"), ("portal", "Portal"), ("both", "Both")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    applies_to = models.CharField(max_length=20, choices=APPLIES_TO_CHOICES)
    layout_json = models.JSONField(default=dict)
    delivery_method = models.CharField(
        max_length=20, choices=DELIVERY_METHOD_CHOICES, default="email"
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("name", "applies_to")
        ordering = ["-is_default", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_applies_to_display()})"


class EmployeePaymentInfo(models.Model):
    PAYMENT_METHOD_CHOICES = [
        ("direct_deposit", "Direct Deposit"),
        ("cash", "Cash"),
        ("paper_check", "Paper Check"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.OneToOneField(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_payment_info"
    )
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    bank_name = models.CharField(max_length=255, blank=True)
    bank_account_number = models.CharField(max_length=50, blank=True)
    bank_ifsc_code = models.CharField(max_length=11, blank=True)
    bank_account_holder_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Employee Payment Info"
        ordering = ["employee"]

    def __str__(self):
        return f"Payment Info - {self.employee_id}"


class EmployeeStatutoryInfo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.OneToOneField(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_statutory_info"
    )
    pan_number = models.CharField(max_length=10, unique=True)
    uan_number = models.CharField(max_length=20, blank=True)
    pf_number = models.CharField(max_length=50, blank=True)
    esi_number = models.CharField(max_length=50, blank=True)
    lwf_applicable = models.BooleanField(default=False)
    professional_tax_state = models.CharField(max_length=2, blank=True)
    professional_tax_exempt = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Employee Statutory Info"
        ordering = ["employee"]

    def __str__(self):
        return f"Statutory Info - {self.employee_id}"


class EmployeeDeduction(models.Model):
    DEDUCTION_TYPE_CHOICES = [("loan", "Loan"), ("advance", "Advance"), ("custom", "Custom")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_deductions"
    )
    deduction_type = models.CharField(max_length=20, choices=DEDUCTION_TYPE_CHOICES)
    # The deduction component each monthly instalment is posted to (PAY-FR-014).
    component = models.ForeignKey(
        "payroll.SalaryComponent", on_delete=models.PROTECT, null=True, blank=True
    )
    name = models.CharField(max_length=255)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    installment_amount = models.DecimalField(max_digits=12, decimal_places=2)
    installments_remaining = models.IntegerField(default=0)
    start_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee", "start_date"]

    def __str__(self):
        return f"{self.name} - {self.employee_id}"


class EmployeeBenefit(models.Model):
    BENEFIT_TYPE_CHOICES = [
        ("health_insurance", "Health Insurance"),
        ("retirement", "Retirement"),
        ("other", "Other"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_benefits"
    )
    benefit_type = models.CharField(max_length=50, choices=BENEFIT_TYPE_CHOICES)
    name = models.CharField(max_length=255)
    provider = models.CharField(max_length=255, blank=True)
    employee_contribution = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    employer_contribution = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    effective_from = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee", "benefit_type"]

    def __str__(self):
        return f"{self.name} - {self.employee_id}"


# =============================================================================
# PRD v1.0 data model (§9). Design rules from the specs:
# - money is Decimal, never float; intermediate precision is kept to 4 places
# - configuration and compensation are effective-dated and versioned; history
#   is never overwritten (PAY-NFR-003)
# - a finalized run is immutable; recalculation creates a new run (PAY-NFR-004)
# =============================================================================

MONEY = {"max_digits": 14, "decimal_places": 2}
PRECISE = {"max_digits": 18, "decimal_places": 4}
DAYS = {"max_digits": 6, "decimal_places": 2}


class TrackedModel(models.Model):
    """Who created/changed a row and when, plus the optimistic-concurrency
    `version` the API checks on every update (PAY_VERSION_CONFLICT)."""

    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ConfigStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


ROUNDING_CHOICES = [
    ("nearest_rupee", "Nearest rupee"),
    ("paise", "Paise (2 decimals)"),
    ("round_up", "Round up to rupee"),
    ("round_down", "Round down to rupee"),
]


# ------------------------------- Pay groups ----------------------------------


class PayGroup(TrackedModel):
    """Payroll calendar plus the policy decisions the Calculation Rules spec
    (§16) says must be configured rather than assumed."""

    PRORATION_CHOICES = [
        ("calendar_days", "Calendar days"),
        ("working_days", "Working days"),
        ("fixed_30", "Fixed 30 days"),
    ]
    REVISION_POLICY_CHOICES = [
        ("split", "Split the period at the effective date"),
        ("next_period", "Apply from the next period"),
    ]
    ATTENDANCE_POLICY_CHOICES = [("warn", "Warn"), ("block", "Block finalization")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=255)
    legal_entity = models.ForeignKey(
        "employees.LegalEntity", on_delete=models.PROTECT, related_name="pay_groups"
    )
    pay_schedule = models.ForeignKey(PaySchedule, on_delete=models.PROTECT, null=True, blank=True)
    frequency = models.CharField(max_length=20, default="monthly")
    pay_day = models.PositiveSmallIntegerField(
        default=0, help_text="Day of month salary is paid; 0 = last day of the period"
    )
    cutoff_day = models.PositiveSmallIntegerField(default=25)
    proration_basis = models.CharField(
        max_length=20, choices=PRORATION_CHOICES, default="calendar_days"
    )
    default_working_days = models.PositiveSmallIntegerField(default=22)
    mid_period_revision_policy = models.CharField(
        max_length=20, choices=REVISION_POLICY_CHOICES, default="split"
    )
    attendance_policy = models.CharField(
        max_length=10, choices=ATTENDANCE_POLICY_CHOICES, default="warn"
    )
    net_pay_rounding = models.CharField(
        max_length=20, choices=ROUNDING_CHOICES, default="nearest_rupee"
    )
    variance_threshold_pct = models.DecimalField(max_digits=6, decimal_places=2, default=10)
    large_input_threshold = models.DecimalField(**MONEY, default=100000)
    approval_stages = models.JSONField(
        default=list,
        blank=True,
        help_text='Ordered stages, e.g. ["finance_review", "final_approval"]',
    )
    require_warning_acknowledgement = models.BooleanField(default=True)
    # Named approvers for the shared Approvals inbox (approvals engine). Blank:
    # the first user holding the stage permission (other than the preparer).
    finance_reviewer = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    final_approver = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def stages(self):
        return list(self.approval_stages or ["finance_review", "final_approval"])

    def __str__(self):
        return self.name


# --------------------------- PAY-001 Components ------------------------------


class SalaryComponent(TrackedModel):
    """PAY-001 / PAY-FR-003/004: an earning, deduction or employer contribution
    defined entirely by configuration."""

    TYPE_CHOICES = [
        ("earning", "Earning"),
        ("deduction", "Deduction"),
        ("employer_contribution", "Employer Contribution"),
    ]
    CATEGORY_CHOICES = [
        ("fixed", "Fixed"),
        ("variable", "Variable"),
        ("statutory", "Statutory"),
        ("reimbursement", "Reimbursement"),
        ("loan", "Loan / Recovery"),
        ("other", "Other"),
    ]
    CALCULATION_CHOICES = [
        ("fixed", "Fixed amount"),
        ("percent_of_ctc", "% of CTC"),
        ("percent_of_component", "% of component (e.g. Basic)"),
        ("formula", "Formula"),
        ("units_rate", "Units × Rate"),
        ("actual", "Actual amount"),
        ("rule_based", "Rule based (statutory)"),
        ("balancing", "Balancing component"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=150)
    payslip_label = models.CharField(max_length=150, blank=True)
    description = models.TextField(blank=True)
    component_type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="fixed")
    calculation_type = models.CharField(max_length=30, choices=CALCULATION_CHOICES)
    # Amount (fixed, monthly), percentage (percent types) or rate (units_rate).
    value = models.DecimalField(**PRECISE, null=True, blank=True)
    base_component_code = models.CharField(max_length=40, blank=True)
    formula_expr = models.TextField(blank=True)
    statutory_rule_code = models.CharField(max_length=40, blank=True)
    is_taxable = models.BooleanField(default=True)
    include_in_pf_wage = models.BooleanField(default=False)
    include_in_esi_wage = models.BooleanField(default=False)
    part_of_ctc = models.BooleanField(default=True)
    part_of_gross = models.BooleanField(default=True)
    part_of_net = models.BooleanField(default=True)
    is_proratable = models.BooleanField(default=True)
    is_lop_applicable = models.BooleanField(default=True)
    show_on_payslip = models.BooleanField(default=True)
    rounding = models.CharField(max_length=20, choices=ROUNDING_CHOICES, default="nearest_rupee")
    applicability = models.JSONField(default=dict, blank=True)
    display_order = models.PositiveIntegerField(default=100)
    status = models.CharField(
        max_length=10, choices=ConfigStatus.choices, default=ConfigStatus.DRAFT
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["component_type", "display_order", "code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


class SalaryComponentVersion(models.Model):
    """Immutable snapshot of a component's configuration, written on every
    create/update, so historical payroll can be reproduced (PAY-NFR-003)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    component = models.ForeignKey(
        SalaryComponent, on_delete=models.CASCADE, related_name="versions"
    )
    version = models.PositiveIntegerField()
    effective_from = models.DateField()
    config = models.JSONField()
    change_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("component", "version")
        ordering = ["component", "-version"]


# ---------------------------- PAY-002 Structures -----------------------------


class SalaryStructure(TrackedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    legal_entity = models.ForeignKey(
        "employees.LegalEntity",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="salary_structures",
    )
    pay_group = models.ForeignKey(PayGroup, on_delete=models.SET_NULL, null=True, blank=True)
    pay_frequency = models.CharField(max_length=20, default="monthly")
    min_ctc = models.DecimalField(**MONEY, null=True, blank=True)
    max_ctc = models.DecimalField(**MONEY, null=True, blank=True)
    eligibility = models.JSONField(default=dict, blank=True)
    reference_ctc = models.DecimalField(
        **MONEY, default=1200000, help_text="Annual CTC used for the builder preview"
    )
    ctc_tolerance = models.DecimalField(**MONEY, default=1)
    status = models.CharField(
        max_length=10, choices=ConfigStatus.choices, default=ConfigStatus.DRAFT
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class SalaryStructureComponent(models.Model):
    """A component inside a structure. Blank calculation fields inherit the
    component's own configuration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    structure = models.ForeignKey(SalaryStructure, on_delete=models.CASCADE, related_name="lines")
    component = models.ForeignKey(SalaryComponent, on_delete=models.PROTECT, related_name="+")
    order = models.PositiveIntegerField(default=0)
    calculation_type = models.CharField(
        max_length=30, choices=SalaryComponent.CALCULATION_CHOICES, blank=True
    )
    value = models.DecimalField(**PRECISE, null=True, blank=True)
    base_component_code = models.CharField(max_length=40, blank=True)
    formula_expr = models.TextField(blank=True)
    is_mandatory = models.BooleanField(default=True)

    class Meta:
        unique_together = ("structure", "component")
        ordering = ["order"]


class SalaryStructureVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    structure = models.ForeignKey(
        SalaryStructure, on_delete=models.CASCADE, related_name="versions"
    )
    version = models.PositiveIntegerField()
    effective_from = models.DateField()
    snapshot = models.JSONField()
    change_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("structure", "version")
        ordering = ["structure", "-version"]


# ----------------------- Statutory rules (configurable) ----------------------


class StatutoryRule(TrackedModel):
    """Effective-dated statutory configuration (rates, ceilings, slabs). Never
    hard-coded: the engine only reads these rows. `is_reviewed` records the
    payroll/compliance owner's sign-off (PRD §16)."""

    CODE_CHOICES = [
        ("PF_EMPLOYEE", "PF - Employee"),
        ("PF_EMPLOYER", "PF - Employer"),
        ("ESI_EMPLOYEE", "ESI - Employee"),
        ("ESI_EMPLOYER", "ESI - Employer"),
        ("PT", "Professional Tax"),
        ("LWF_EMPLOYEE", "LWF - Employee"),
        ("LWF_EMPLOYER", "LWF - Employer"),
        ("TDS", "TDS"),
        ("GRATUITY", "Gratuity"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, choices=CODE_CHOICES)
    name = models.CharField(max_length=150)
    legal_entity = models.ForeignKey(
        "employees.LegalEntity", on_delete=models.CASCADE, null=True, blank=True
    )
    state = models.CharField(max_length=50, blank=True, help_text="Blank = all states")
    params = models.JSONField(default=dict)
    status = models.CharField(
        max_length=10, choices=ConfigStatus.choices, default=ConfigStatus.ACTIVE
    )
    is_reviewed = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["code", "state", "-effective_from"]

    def __str__(self):
        return f"{self.code} {self.state or 'ALL'} from {self.effective_from}"


# ------------------------- PAY-003 Payroll profile ---------------------------


class EmployeePayrollProfile(TrackedModel):
    """Payroll-specific attributes of an employee. Identity comes from the
    Employee Directory; this row only holds what payroll owns. Effective-dated:
    a change from a new date closes the previous row instead of editing it."""

    STATUS_CHOICES = [
        ("active", "Active"),
        ("on_hold", "On hold"),
        ("not_eligible", "Not eligible"),
        ("exited", "Exited"),
    ]
    REGIME_CHOICES = [("new", "New regime"), ("old", "Old regime")]
    PAYMENT_MODE_CHOICES = [
        ("bank_transfer", "Bank transfer"),
        ("cheque", "Cheque"),
        ("cash", "Cash"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_profiles"
    )
    pay_group = models.ForeignKey(PayGroup, on_delete=models.PROTECT, null=True, blank=True)
    payroll_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    work_state = models.CharField(max_length=50, blank=True)
    tax_regime = models.CharField(max_length=10, choices=REGIME_CHOICES, default="new")
    pf_applicable = models.BooleanField(default=True)
    esi_applicable = models.BooleanField(default=False)
    pt_applicable = models.BooleanField(default=True)
    lwf_applicable = models.BooleanField(default=False)
    payment_mode = models.CharField(
        max_length=20, choices=PAYMENT_MODE_CHOICES, default="bank_transfer"
    )
    payroll_start_date = models.DateField(null=True, blank=True)
    payroll_end_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["employee", "-effective_from"]


# -------------------- PAY-004 / PAY-005 Compensation -------------------------


class CompensationRevision(TrackedModel):
    """A proposed assignment or revision. Nothing about the employee's pay
    changes until it is fully approved; approval creates a new
    EmployeeCompensation and closes the previous one (PAY-FR-006/007)."""

    TYPE_CHOICES = [
        ("new_assignment", "New Assignment"),
        ("annual_revision", "Annual Revision"),
        ("promotion", "Promotion"),
        ("role_change", "Role Change"),
        ("correction", "Correction"),
        ("other", "Other"),
    ]
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("pending_approval", "Pending Approval"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("returned", "Returned"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="compensation_revisions"
    )
    revision_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    current_compensation = models.ForeignKey(
        "EmployeeCompensation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    structure = models.ForeignKey(SalaryStructure, on_delete=models.PROTECT)
    annual_ctc = models.DecimalField(**MONEY)
    effective_from = models.DateField()
    reason = models.CharField(max_length=255, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    breakup = models.JSONField(default=dict, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    resulting_compensation = models.ForeignKey(
        "EmployeeCompensation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]


class EmployeeCompensation(models.Model):
    """An approved, effective-dated compensation. Rows are never edited except
    to close them (effective_to / status=superseded)."""

    STATUS_CHOICES = [
        ("active", "Active"),
        ("superseded", "Superseded"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="compensations"
    )
    version_no = models.PositiveIntegerField()
    structure = models.ForeignKey(SalaryStructure, on_delete=models.PROTECT)
    structure_version = models.PositiveIntegerField()
    annual_ctc = models.DecimalField(**MONEY)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    revision = models.ForeignKey(
        CompensationRevision, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    revision_type = models.CharField(max_length=20, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    breakup = models.JSONField(default=dict)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    approved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("employee", "version_no")
        ordering = ["employee", "-effective_from"]


# ------------------------------- Periods -------------------------------------


class PayrollPeriod(TrackedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("in_progress", "In Progress"),
        ("ready_for_review", "Ready for Review"),
        ("pending_approval", "Pending Approval"),
        ("approved", "Approved"),
        ("finalized", "Finalized / Locked"),
        ("reopened", "Reopened"),
        ("completed", "Completed"),
    ]
    LOCKED_STATUSES = ("finalized", "completed")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pay_group = models.ForeignKey(PayGroup, on_delete=models.PROTECT, related_name="periods")
    year = models.PositiveIntegerField()
    month = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    start_date = models.DateField()
    end_date = models.DateField()
    pay_date = models.DateField()
    cutoff_at = models.DateTimeField(null=True, blank=True)
    working_days = models.PositiveSmallIntegerField(default=22)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    step_status = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    finalized_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("pay_group", "year", "month")
        ordering = ["-year", "-month"]

    @property
    def is_locked(self):
        return self.status in self.LOCKED_STATUSES

    def __str__(self):
        return f"{self.pay_group.code} {self.year}-{self.month:02d}"


class InputSnapshot(models.Model):
    """Immutable capture of source-module data for a period (API contract §5)."""

    KIND_CHOICES = [
        ("employee", "Employee master"),
        ("attendance", "Attendance & leave"),
        ("timesheet", "Timesheet / OT"),
        ("configuration", "Configuration"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name="snapshots")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    version = models.PositiveIntegerField()
    source = models.CharField(max_length=50, blank=True)
    is_final = models.BooleanField(default=False)
    row_count = models.PositiveIntegerField(default=0)
    checksum = models.CharField(max_length=64, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    captured_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    captured_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("period", "kind", "version")
        ordering = ["period", "kind", "-version"]


class AttendancePayrollInput(models.Model):
    """PAY-007: finalized payable days / LOP per employee for a period."""

    STATUS_CHOICES = [("pending", "Pending"), ("final", "Final")]
    SOURCE_CHOICES = [
        ("attendance_module", "Attendance module"),
        ("import", "Import"),
        ("manual", "Manual entry"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name="attendance")
    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="+")
    snapshot = models.ForeignKey(InputSnapshot, on_delete=models.SET_NULL, null=True, blank=True)
    working_days = models.DecimalField(**DAYS)
    payable_days = models.DecimalField(**DAYS)
    present_days = models.DecimalField(**DAYS, default=0)
    lop_days = models.DecimalField(**DAYS, default=0)
    paid_leave_days = models.DecimalField(**DAYS, default=0)
    unpaid_leave_days = models.DecimalField(**DAYS, default=0)
    ot_hours = models.DecimalField(**DAYS, default=0)
    pending_leave_requests = models.PositiveSmallIntegerField(default=0)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="manual")
    source_ref = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="final")
    override_reason = models.CharField(max_length=255, blank=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("period", "employee")
        ordering = ["employee__employee_code"]


class PayrollInput(TrackedModel):
    """PAY-008/010: variable earnings and deductions for a period. Only
    approved inputs reach the calculation."""

    TYPE_CHOICES = [
        ("bonus", "Bonus"),
        ("incentive", "Incentive"),
        ("overtime", "Overtime"),
        ("shift_allowance", "Shift Allowance"),
        ("arrears", "Arrears"),
        ("one_time_earning", "One-time Earning"),
        ("reimbursement", "Reimbursement"),
        ("adhoc_deduction", "Ad-hoc Deduction"),
        ("recovery", "Recovery"),
        ("loan_recovery", "Loan / Advance Recovery"),
        ("tds", "TDS (manual)"),
    ]
    EARNING_TYPES = (
        "bonus",
        "incentive",
        "overtime",
        "shift_allowance",
        "arrears",
        "one_time_earning",
        "reimbursement",
    )
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("pending", "Pending Approval"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("included", "Included"),
        ("superseded", "Superseded"),
    ]
    SOURCE_CHOICES = [
        ("manual", "Manual"),
        ("import", "Import"),
        ("timesheet", "Timesheet"),
        ("expenses", "Expenses"),
        ("loan_schedule", "Loan schedule"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name="inputs")
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="payroll_inputs"
    )
    input_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    component = models.ForeignKey(SalaryComponent, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(**MONEY, null=True, blank=True)
    units = models.DecimalField(**DAYS, null=True, blank=True)
    rate = models.DecimalField(**PRECISE, null=True, blank=True)
    reason = models.CharField(max_length=255)
    remarks = models.TextField(blank=True)
    reference_period = models.CharField(max_length=20, blank=True)
    expense_date = models.DateField(null=True, blank=True)
    source_module = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="manual")
    source_record_id = models.CharField(max_length=100, blank=True)
    source_batch_id = models.CharField(max_length=100, blank=True)
    source_row_key = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    approved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    decision_comment = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["period", "source_batch_id", "source_row_key"],
                condition=~models.Q(source_batch_id="") & ~models.Q(source_row_key=""),
                name="payroll_input_unique_source_row",
            )
        ]


class PayrollEmployeeAction(TrackedModel):
    """PAY-009 and step 5: per-period decisions for joiners, exits and holds."""

    KIND_CHOICES = [("joiner", "New joiner"), ("exit", "Exit"), ("hold", "Salary hold")]
    DECISION_CHOICES = [
        ("process", "Process"),
        ("hold", "Hold"),
        ("review", "Needs review"),
        ("ff_pending", "F&F pending"),
        ("released", "Released"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(
        PayrollPeriod, on_delete=models.CASCADE, related_name="employee_actions"
    )
    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    decision = models.CharField(max_length=20, choices=DECISION_CHOICES, default="process")
    reason = models.CharField(max_length=255, blank=True)

    class Meta:
        unique_together = ("period", "employee", "kind")


# ------------------------------- Runs & results ------------------------------


class PayrollRun(models.Model):
    STATUS_CHOICES = [
        ("created", "Created"),
        ("calculating", "Calculating"),
        ("calculated", "Calculated"),
        ("validation_failed", "Validation Failed"),
        ("ready", "Ready"),
        ("submitted", "Submitted"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("returned", "Returned"),
        ("finalized", "Finalized"),
        ("reopened", "Reopened"),
        ("superseded", "Superseded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name="runs")
    run_no = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="created")
    is_current = models.BooleanField(default=True)
    mode = models.CharField(max_length=30, default="DRAFT_RECALCULATION")
    engine_version = models.CharField(max_length=20)
    input_snapshot_id = models.CharField(max_length=64, blank=True)
    configuration_snapshot_id = models.CharField(max_length=64, blank=True)
    configuration_snapshot = models.JSONField(default=dict, blank=True)
    employee_count = models.PositiveIntegerField(default=0)
    gross_total = models.DecimalField(**MONEY, default=0)
    deduction_total = models.DecimalField(**MONEY, default=0)
    net_total = models.DecimalField(**MONEY, default=0)
    employer_cost_total = models.DecimalField(**MONEY, default=0)
    error_count = models.PositiveIntegerField(default=0)
    warning_count = models.PositiveIntegerField(default=0)
    info_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    calculated_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    finalized_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    reopened_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopen_reason = models.TextField(blank=True)

    class Meta:
        unique_together = ("period", "run_no")
        ordering = ["-created_at"]

    @property
    def is_immutable(self):
        return self.status in ("finalized", "reopened", "superseded")


class EmployeePayrollResult(models.Model):
    STATUS_CHOICES = [
        ("ready", "Ready"),
        ("warning", "Warning"),
        ("error", "Error"),
        ("on_hold", "On Hold"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="results")
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.PROTECT, related_name="payroll_results"
    )
    compensation = models.ForeignKey(
        EmployeeCompensation, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    employee_snapshot = models.JSONField(default=dict)
    working_days = models.DecimalField(**DAYS, default=0)
    payable_days = models.DecimalField(**DAYS, default=0)
    lop_days = models.DecimalField(**DAYS, default=0)
    gross_earnings = models.DecimalField(**MONEY, default=0)
    total_deductions = models.DecimalField(**MONEY, default=0)
    net_pay = models.DecimalField(**MONEY, default=0)
    employer_contributions = models.DecimalField(**MONEY, default=0)
    employer_cost = models.DecimalField(**MONEY, default=0)
    validation_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ready")
    is_on_hold = models.BooleanField(default=False)
    is_joiner = models.BooleanField(default=False)
    is_exit = models.BooleanField(default=False)
    has_revision = models.BooleanField(default=False)
    previous_net_pay = models.DecimalField(**MONEY, null=True, blank=True)
    variance_amount = models.DecimalField(**MONEY, null=True, blank=True)
    variance_pct = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    segments = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("run", "employee")
        ordering = ["employee__employee_code"]


class PayrollResultComponent(models.Model):
    """One component line of a result, with its calculation trace (PAY-012)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    result = models.ForeignKey(
        EmployeePayrollResult, on_delete=models.CASCADE, related_name="lines"
    )
    component = models.ForeignKey(
        SalaryComponent, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    component_code = models.CharField(max_length=40)
    component_name = models.CharField(max_length=150)
    component_type = models.CharField(max_length=30)
    sequence = models.PositiveIntegerField(default=0)
    amount = models.DecimalField(**MONEY)
    pre_round_amount = models.DecimalField(**PRECISE)
    calculated_amount = models.DecimalField(**MONEY)
    is_overridden = models.BooleanField(default=False)
    is_taxable = models.BooleanField(default=True)
    show_on_payslip = models.BooleanField(default=True)
    rate_display = models.CharField(max_length=40, blank=True)
    units_display = models.CharField(max_length=40, blank=True)
    calculation_basis = models.TextField(blank=True)
    formula = models.TextField(blank=True)
    inputs = models.JSONField(default=dict, blank=True)
    rule_version = models.CharField(max_length=100, blank=True)
    source_refs = models.JSONField(default=list, blank=True)
    dependencies = models.JSONField(default=list, blank=True)
    override_ref = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["sequence"]


class PayrollOverride(models.Model):
    """Authorised component override with reason (Calc Rules §10). The
    calculated value is kept on the result line alongside the override."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, related_name="overrides")
    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="+")
    component = models.ForeignKey(SalaryComponent, on_delete=models.PROTECT, related_name="+")
    override_amount = models.DecimalField(**MONEY)
    original_amount = models.DecimalField(**MONEY, null=True, blank=True)
    reason = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class PayrollException(models.Model):
    SEVERITY_CHOICES = [
        ("blocking", "Blocking Error"),
        ("warning", "Warning"),
        ("info", "Information"),
    ]
    STATUS_CHOICES = [
        ("open", "Open"),
        ("acknowledged", "Acknowledged"),
        ("resolved", "Resolved"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="exceptions")
    result = models.ForeignKey(
        EmployeePayrollResult,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="exceptions",
    )
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES)
    rule_code = models.CharField(max_length=60)
    message = models.CharField(max_length=500)
    details = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="open")
    resolution_note = models.CharField(max_length=500, blank=True)
    acknowledged_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["severity", "rule_code"]


class PayrollApproval(models.Model):
    """One approval stage for a payroll run or a compensation revision."""

    STAGE_CHOICES = [
        ("prepared", "Prepared"),
        ("finance_review", "Finance Review"),
        ("final_approval", "Final Approval"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("returned", "Returned"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(
        PayrollRun, on_delete=models.CASCADE, null=True, blank=True, related_name="approvals"
    )
    revision = models.ForeignKey(
        CompensationRevision,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="approvals",
    )
    stage = models.CharField(max_length=20, choices=STAGE_CHOICES)
    sequence = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    approver = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    comments = models.TextField(blank=True)
    acted_at = models.DateTimeField(null=True, blank=True)
    # The shared-inbox request raised for this stage (approvals engine).
    inbox_request = models.ForeignKey(
        "approvals.Request", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence", "created_at"]


# ------------------------------- Outputs -------------------------------------


class Payslip(models.Model):
    STATUS_CHOICES = [
        ("generated", "Generated"),
        ("released", "Released"),
        ("superseded", "Superseded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    result = models.ForeignKey(
        EmployeePayrollResult, on_delete=models.PROTECT, related_name="payslips"
    )
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.PROTECT, related_name="payslips"
    )
    period = models.ForeignKey(PayrollPeriod, on_delete=models.PROTECT, related_name="payslips")
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="generated")
    payload = models.JSONField(default=dict)
    net_pay = models.DecimalField(**MONEY, default=0)
    generated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    generated_at = models.DateTimeField(auto_now_add=True)
    released_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    released_at = models.DateTimeField(null=True, blank=True)
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-period__year", "-period__month", "employee__employee_code"]


class PayrollOutput(models.Model):
    """PAY-FR-026: generated bank advice, statutory reports and journal."""

    KIND_CHOICES = [
        ("bank_advice", "Bank Advice / Payment File"),
        ("statutory_pf", "PF Report"),
        ("statutory_esi", "ESI Report"),
        ("statutory_pt", "PT Report"),
        ("statutory_tds", "TDS Report"),
        ("statutory_lwf", "LWF Report"),
        ("journal", "Payroll Journal"),
    ]
    STATUS_CHOICES = [
        ("generated", "Generated"),
        ("paid", "Paid"),
        ("superseded", "Superseded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(PayrollRun, on_delete=models.PROTECT, related_name="outputs")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="generated")
    file_name = models.CharField(max_length=200)
    content = models.TextField()
    record_count = models.PositiveIntegerField(default=0)
    total_amount = models.DecimalField(**MONEY, default=0)
    generated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    generated_at = models.DateTimeField(auto_now_add=True)
    paid_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["kind", "-version"]


class IdempotencyRecord(models.Model):
    """Replays the first response for a retried calculate/finalize/generate
    request carrying the same Idempotency-Key (API contract §11)."""

    key = models.CharField(max_length=100)
    scope = models.CharField(max_length=200)
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    status_code = models.PositiveSmallIntegerField()
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("key", "scope", "user")
