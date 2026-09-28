import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone

CATEGORY_PREBOARDING = 'preboarding'
CATEGORY_ONBOARDING = 'onboarding'
CATEGORY_CHOICES = [
    (CATEGORY_PREBOARDING, 'Preboarding'),  # offer accepted -> Day 1
    (CATEGORY_ONBOARDING, 'Onboarding'),  # Day 1 -> first weeks
]

OWNER_NEW_HIRE = 'new_hire'
OWNER_HR_ADMIN = 'hr_admin'
OWNER_MANAGER = 'manager'
OWNER_BUDDY = 'buddy'
OWNER_IT_ADMIN = 'it_admin'
OWNER_CHOICES = [
    (OWNER_NEW_HIRE, 'New hire'),
    (OWNER_HR_ADMIN, 'HR Admin'),
    (OWNER_MANAGER, 'Manager'),
    (OWNER_BUDDY, 'Buddy'),
    (OWNER_IT_ADMIN, 'IT Admin'),
]

STAGE_PREBOARDING = 'preboarding'
STAGE_ONBOARDING = 'onboarding'
STAGE_COMPLETED = 'completed'
STAGE_CHOICES = [
    (STAGE_PREBOARDING, 'Preboarding'),
    (STAGE_ONBOARDING, 'Onboarding'),
    (STAGE_COMPLETED, 'Completed'),
]

TASK_PENDING = 'pending'
TASK_IN_PROGRESS = 'in_progress'
TASK_DONE = 'done'
TASK_SKIPPED = 'skipped'
TASK_STATUS_CHOICES = [
    (TASK_PENDING, 'Pending'),
    (TASK_IN_PROGRESS, 'In progress'),
    (TASK_DONE, 'Done'),
    (TASK_SKIPPED, 'Skipped'),
]

EMPLOYMENT_FULL_TIME = 'full_time'
EMPLOYMENT_CONTRACT = 'contract'
EMPLOYMENT_INTERN = 'intern'
EMPLOYMENT_TYPE_CHOICES = [
    (EMPLOYMENT_FULL_TIME, 'Full-time'),
    (EMPLOYMENT_CONTRACT, 'Contract'),
    (EMPLOYMENT_INTERN, 'Intern'),
]

# The offer lifecycle (docs/REQUIREMENTS.md, "electronic signature" workflow).
# A generic status column, not a workflow engine (docs/ARCHITECTURE.md) — but
# with real transition validation (see services.ALLOWED_OFFER_TRANSITIONS),
# because signature/acceptance is exactly the kind of irreversible, legally
# meaningful transition that must not be reachable from any state.
OFFER_DRAFT = 'draft'  # HR is still editing; not yet rendered to PDF this version.
OFFER_GENERATED = 'generated'  # PDF rendered; not yet emailed. (Legacy rows may sit here or at 'draft'.)
OFFER_SENT = 'sent'  # Emailed with a signing link. Historical marker — see AWAITING_SIGNATURE below.
OFFER_VIEWED = 'viewed'  # Candidate opened the secure signing link at least once.
OFFER_AWAITING_SIGNATURE = 'awaiting_signature'  # The resting "ball's in the candidate's court" state.
OFFER_SIGNED = 'signed'  # Signature captured — set together with ACCEPTED (see services.accept_offer).
OFFER_ACCEPTED = 'accepted'  # Terminal, success. Triggers preboarding.
OFFER_REJECTED = 'rejected'  # Terminal. Workflow stops.
OFFER_EXPIRED = 'expired'  # Terminal (until HR extends/resends, which creates a new version).
OFFER_CANCELLED = 'cancelled'  # Terminal. HR withdrew this version (e.g. superseded by an edit).

# States in which the candidate's signing link is still usable.
OFFER_SIGNABLE_STATUSES = {OFFER_SENT, OFFER_VIEWED, OFFER_AWAITING_SIGNATURE}
# Terminal states — no further transition is ever valid from these.
OFFER_TERMINAL_STATUSES = {OFFER_ACCEPTED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_CANCELLED}

OFFER_STATUS_CHOICES = [
    (OFFER_DRAFT, 'Draft'),
    (OFFER_GENERATED, 'Generated'),
    (OFFER_SENT, 'Sent'),
    (OFFER_VIEWED, 'Viewed'),
    (OFFER_AWAITING_SIGNATURE, 'Awaiting signature'),
    (OFFER_SIGNED, 'Signed'),
    (OFFER_ACCEPTED, 'Accepted'),
    (OFFER_REJECTED, 'Rejected'),
    (OFFER_EXPIRED, 'Expired'),
    (OFFER_CANCELLED, 'Cancelled'),
]

REJECTION_COMPENSATION = 'compensation'
REJECTION_ANOTHER_OFFER = 'another_offer'
REJECTION_PERSONAL_REASONS = 'personal_reasons'
REJECTION_JOINING_DATE = 'joining_date'
REJECTION_LOCATION = 'location'
REJECTION_JOB_ROLE = 'job_role'
REJECTION_OTHER = 'other'
OFFER_REJECTION_REASON_CHOICES = [
    (REJECTION_COMPENSATION, 'Compensation'),
    (REJECTION_ANOTHER_OFFER, 'Accepted another offer'),
    (REJECTION_PERSONAL_REASONS, 'Personal reasons'),
    (REJECTION_JOINING_DATE, 'Joining date'),
    (REJECTION_LOCATION, 'Location'),
    (REJECTION_JOB_ROLE, 'Job role'),
    (REJECTION_OTHER, 'Other'),
]


def _generate_signing_token() -> str:
    """256 bits of CSPRNG entropy, URL-safe — `secrets` is the stdlib's
    cryptographically secure source (not `random`). Returned once, to the
    caller that emails it; only its hash (see `hash_signing_token`) is ever
    persisted, so a database read can never leak a usable token."""
    return secrets.token_urlsafe(32)


def hash_signing_token(raw_token: str) -> str:
    """One-way — signing tokens are bearer credentials (docs/REQUIREMENTS.md
    security baseline: don't store raw sensitive tokens). SHA-256 is
    appropriate here (not a password hasher): the token already has 256 bits
    of uniform entropy, so there's nothing for a slow KDF to protect against
    that a fast, collision-resistant digest doesn't already cover."""
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

BGV_NOT_STARTED = 'not_started'
BGV_PENDING_DOCUMENTS = 'pending_documents'
BGV_READY_FOR_REVIEW = 'ready_for_review'
BGV_PASSED = 'passed'
BGV_FAILED = 'failed'
BGV_STATUS_CHOICES = [
    (BGV_NOT_STARTED, 'Not started'),
    (BGV_PENDING_DOCUMENTS, 'Pending documents'),
    (BGV_READY_FOR_REVIEW, 'Ready for review'),
    (BGV_PASSED, 'Passed'),
    (BGV_FAILED, 'Failed'),
]


class OnboardingTaskTemplate(models.Model):
    """HR Admin-managed checklist template. New hires get a copy of every
    active template's tasks generated onto their `OnboardingProfile` — this is
    the "buttons to manage the checklist" surface, not a workflow engine."""

    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    owner = models.CharField(max_length=20, choices=OWNER_CHOICES, default=OWNER_NEW_HIRE)
    is_required = models.BooleanField(default=True)
    requires_document = models.BooleanField(default=False)
    # Days relative to joining_date: negative = before Day 1, 0 = Day 1, positive = after.
    offset_days = models.IntegerField(default=0)
    sort_order = models.PositiveIntegerField(default=0)
    # Optional named person (e.g. the IT admin for "Provision laptop") —
    # copied onto each generated task; overridable per task.
    assignee = models.ForeignKey('employees.Employee', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    is_active = models.BooleanField(default=True)  # soft-delete only
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'sort_order', 'id']

    def __str__(self):
        return f'[{self.category}] {self.title}'


class OnboardingProfile(models.Model):
    """One row per new hire being tracked through preboarding/onboarding."""

    employee = models.OneToOneField('employees.Employee', on_delete=models.CASCADE, related_name='onboarding_profile')
    buddy = models.ForeignKey(
        'employees.Employee', on_delete=models.SET_NULL, null=True, blank=True, related_name='onboarding_buddy_for'
    )
    stage = models.CharField(max_length=20, choices=STAGE_CHOICES, default=STAGE_PREBOARDING)
    day1_completed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Onboarding for {self.employee_id} ({self.stage})'

    @property
    def current_offer_letter(self):
        """The one offer version that's actually live — see OfferLetter's
        `is_current`/versioning docstring. Callers that fetch many profiles
        should `Prefetch('offer_letters', queryset=OfferLetter.objects.filter(
        is_current=True), to_attr='_current_offer_letter_cache')` to avoid an
        N+1 query here; this falls back to a direct query otherwise."""
        cached = getattr(self, '_current_offer_letter_cache', None)
        if cached is not None:
            return cached[0] if cached else None
        return self.offer_letters.filter(is_current=True).first()


# Placeholders a template's `heading`/`body` can use — substituted as plain
# text (no template language, no `eval`/`exec`; see offer_letter.py) before
# being escaped into the PDF. Keep this list and offer_letter.py's context
# dict in services.py in sync — it's the contract the HR-facing editor's
# "insert placeholder" helper is built against.
OFFER_LETTER_PLACEHOLDERS = [
    'first_name', 'last_name', 'full_name', 'designation', 'department',
    'employee_code', 'joining_date', 'employment_type',
    'probation_period_months', 'notice_period_days', 'today', 'reporting_manager',
    # Salary structure — each pair is the annual figure and its /12 monthly
    # equivalent. `package`/`monthly_package` are the Total CTC (the sum of
    # the four components below), not a separate number HR enters.
    'package', 'monthly_package',
    'basic_salary', 'basic_salary_monthly',
    'hra', 'hra_monthly',
    'other_allowances', 'other_allowances_monthly',
    'other_components', 'other_components_monthly',
]


class OfferLetterTemplate(models.Model):
    """HR-editable offer letter wording — e.g. a different template for
    interns vs. full-time hires. Two ways to author one:

    1. `source_docx` — HR uploads a real Word (.docx) file, e.g. their
       existing letterhead/branded template, with `{{placeholder}}` tokens
       typed directly into the document text (see OFFER_LETTER_PLACEHOLDERS).
       Rendering fills the placeholders in Word itself and converts the
       result to PDF via Word (see onboarding/offer_letter_docx.py) — full
       fidelity: fonts, logo, letterhead, tables, whatever the .docx has.
    2. `body` — plain text typed in-app, same placeholder syntax, rendered
       through reportlab (onboarding/offer_letter.py). No file to manage,
       but no branding beyond what that renderer draws.

    If both are set, `source_docx` wins. Exactly one template should be
    `is_default` at a time; new-hire creation falls back to it when HR
    doesn't pick one explicitly."""

    name = models.CharField(max_length=150)
    heading = models.CharField(max_length=150, default='Offer of Employment')
    body = models.TextField(blank=True, default='')
    source_docx = models.FileField(upload_to='offer_letter_templates/', null=True, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)  # soft-delete only
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name']

    def __str__(self):
        return self.name


def next_offer_number() -> str:
    last = OfferLetter.objects.order_by('-id').values_list('offer_number', flat=True).first()
    n = 0
    if last and last.startswith('OFR'):
        try:
            n = int(last[3:].split('-')[0])
        except ValueError:
            n = OfferLetter.objects.filter(version=1).count()
    else:
        n = OfferLetter.objects.filter(version=1).count()
    return f'OFR{n + 1:05d}'


class OfferLetter(models.Model):
    """The offer letter for a new hire, and the electronic-signature workflow
    around it. Generated as a PDF (`documents.Document`,
    entity_type='offer_letter') the moment HR creates the record; HR reviews
    and explicitly sends it — it is never emailed automatically. Salary is a
    sensitive field (docs/REQUIREMENTS.md security baseline) — readable only
    by the employee themselves, hr_admin, and finance; see documents/access.py.

    Versioned: `profile` is a plain FK (not OneToOne) because editing an
    already-sent offer creates a new row rather than mutating history (see
    services.create_new_offer_version). `offer_number` is shared across every
    version of the same offer; `version` increments; exactly one version per
    `offer_number` has `is_current=True` — that is the only one a candidate's
    (still-valid) signing token can ever resolve to, and the only one
    `OnboardingProfile.current_offer_letter` returns.
    """

    profile = models.ForeignKey(OnboardingProfile, on_delete=models.CASCADE, related_name='offer_letters')
    template = models.ForeignKey(OfferLetterTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    offer_number = models.CharField(max_length=20, db_index=True)
    version = models.PositiveSmallIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    previous_version = models.OneToOneField(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='next_version'
    )
    # A real salary structure, not one lump sum — each an annual figure.
    # annual_ctc is never set directly; it's always their sum (see save()),
    # so the two can never drift out of sync.
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_components = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    annual_ctc = models.DecimalField(max_digits=12, decimal_places=2, editable=False)
    currency = models.CharField(max_length=3, default='INR')
    employment_type = models.CharField(max_length=20, choices=EMPLOYMENT_TYPE_CHOICES, default=EMPLOYMENT_FULL_TIME)
    probation_period_months = models.PositiveSmallIntegerField(default=3)
    notice_period_days = models.PositiveSmallIntegerField(default=30)
    status = models.CharField(max_length=20, choices=OFFER_STATUS_CHOICES, default=OFFER_DRAFT)
    document = models.ForeignKey('documents.Document', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    generated_at = models.DateTimeField(auto_now_add=True)

    # --- Signing token (see hash_signing_token) ---------------------------
    # Only the hash is stored; the raw token exists only in the URL emailed
    # to the candidate and is never logged or persisted (docs/REQUIREMENTS.md
    # §5, §21). A fresh token/expiry is issued on every send/resend and
    # invalidated (signing_token_hash cleared) the moment it's consumed by a
    # sign/reject, or superseded by a new version — so it can never be reused.
    signing_token_hash = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    signing_token_expires_at = models.DateTimeField(null=True, blank=True)

    # --- Workflow timestamps (docs/REQUIREMENTS.md §3) ---------------------
    sent_at = models.DateTimeField(null=True, blank=True)
    viewed_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    # --- Signature capture (InAppSignatureProvider — see esignature.py) ---
    signature_name = models.CharField(max_length=200, blank=True, default='')
    signature_ip = models.GenericIPAddressField(null=True, blank=True)
    signature_user_agent = models.CharField(max_length=500, blank=True, default='')

    # --- Rejection ----------------------------------------------------------
    rejection_reason = models.CharField(max_length=30, choices=OFFER_REJECTION_REASON_CHOICES, blank=True, default='')
    rejection_comments = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-version']
        indexes = [models.Index(fields=['offer_number'])]
        constraints = [
            # Exactly one current version per offer_number — enforced in the
            # DB, not just in services.py, so a bug can't silently leave two
            # "current" rows a candidate's token could ambiguously resolve to.
            models.UniqueConstraint(
                fields=['offer_number'], condition=models.Q(is_current=True), name='unique_current_offer_version'
            ),
        ]

    def save(self, *args, **kwargs):
        self.annual_ctc = self.basic_salary + self.hra + self.other_allowances + self.other_components
        if not self.offer_number:
            self.offer_number = next_offer_number()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.offer_number} v{self.version} for {self.profile.employee_id} ({self.status})'

    def issue_signing_token(self, *, ttl_hours: int | None = None, expires_at=None) -> str:
        """Generates a new raw token, persists only its hash + expiry, and
        returns the raw token for the caller to put in the email/link — the
        one and only time it exists outside this call stack. Pass
        `expires_at` directly (rather than `ttl_hours`) to reissue a usable
        token without moving the deadline — see
        services.send_offer_expiry_reminder, which must not silently extend
        the signing window just because a reminder went out."""
        raw_token = _generate_signing_token()
        self.signing_token_hash = hash_signing_token(raw_token)
        self.signing_token_expires_at = expires_at or (timezone.now() + timezone.timedelta(hours=ttl_hours))
        return raw_token

    def invalidate_signing_token(self) -> None:
        self.signing_token_hash = None
        self.signing_token_expires_at = None

    @property
    def is_token_expired(self) -> bool:
        return bool(self.signing_token_expires_at and self.signing_token_expires_at <= timezone.now())


class OnboardingTask(models.Model):
    profile = models.ForeignKey(OnboardingProfile, on_delete=models.CASCADE, related_name='tasks')
    template = models.ForeignKey(OnboardingTaskTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    owner = models.CharField(max_length=20, choices=OWNER_CHOICES, default=OWNER_NEW_HIRE)
    is_required = models.BooleanField(default=True)
    requires_document = models.BooleanField(default=False)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=TASK_STATUS_CHOICES, default=TASK_PENDING)
    sort_order = models.PositiveIntegerField(default=0)
    # A named person who may complete this task, in addition to its `owner` role.
    assignee = models.ForeignKey('employees.Employee', on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_onboarding_tasks')
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'sort_order', 'id']

    def __str__(self):
        return f'{self.title} ({self.status})'


ACCESS_AREA_BANK_DETAILS = 'bank_details'
ACCESS_AREA_IDENTITY_DOCUMENTS = 'identity_documents'
ACCESS_AREA_EDUCATION = 'education'
ACCESS_AREA_LAPTOP = 'laptop'
ACCESS_AREA_WORK_EMAIL = 'work_email'
ACCESS_AREA_ID_CARD = 'id_card'
ACCESS_AREA_CHOICES = [
    (ACCESS_AREA_BANK_DETAILS, 'Bank details'),
    (ACCESS_AREA_IDENTITY_DOCUMENTS, 'Identity documents'),
    (ACCESS_AREA_EDUCATION, 'Degrees & certificates'),
    (ACCESS_AREA_LAPTOP, 'Issue laptop'),
    (ACCESS_AREA_WORK_EMAIL, 'Work email setup'),
    (ACCESS_AREA_ID_CARD, 'Issue ID card'),
]

IT_ACCESS_AREAS = [ACCESS_AREA_LAPTOP, ACCESS_AREA_WORK_EMAIL, ACCESS_AREA_ID_CARD]


class OnboardingAccessGrant(models.Model):
    """HR lets a named person (e.g. payroll) see one sensitive area for every
    new hire — on top of the role-based HR/Finance access. Read-only:
    verifying stays HR-only, and revealing full numbers stays audited."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='onboarding_access_grants')
    area = models.CharField(max_length=30, choices=ACCESS_AREA_CHOICES)
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'area'], name='unique_onboarding_access_grant')]

    def __str__(self):
        return f'{self.user_id} -> {self.area}'


def has_access_grant(user, area: str) -> bool:
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    return OnboardingAccessGrant.objects.filter(user=user, area=area).exists()


class BackgroundVerification(models.Model):
    """Tracks the org's own document-collection/review workflow — not a
    real third-party BGV check. `status` moves not_started -> pending_documents
    automatically once any required doc-backed task exists, then
    -> ready_for_review automatically once every one of those tasks is
    done (see services.refresh_background_verification_status), and only
    HR can move it to passed/failed (that pass/fail judgment isn't
    something this system can fabricate)."""
    profile = models.OneToOneField(OnboardingProfile, on_delete=models.CASCADE, related_name='background_verification')
    status = models.CharField(max_length=20, choices=BGV_STATUS_CHOICES, default=BGV_NOT_STARTED)
    notes = models.TextField(blank=True, default='')
    ready_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'BGV for {self.profile.employee.full_name} ({self.status})'


class OnboardingWebhookEvent(models.Model):
    """Idempotency ledger for `/api/v1/webhooks/esign` (docs/REQUIREMENTS.md
    §16-17): a (provider, external_event_id) pair is processed at most once,
    ever. Not used by the default `InAppSignatureProvider` (esignature.py) —
    the candidate calls our own sign/reject endpoints directly, no webhook in
    that path — this exists for when an external provider is configured."""

    provider = models.CharField(max_length=40)
    external_event_id = models.CharField(max_length=200)
    event_type = models.CharField(max_length=60)
    offer = models.ForeignKey(OfferLetter, on_delete=models.SET_NULL, null=True, blank=True, related_name='webhook_events')
    payload_json = models.JSONField(default=dict, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['provider', 'external_event_id'], name='unique_webhook_event'),
        ]

    def __str__(self):
        return f'{self.provider}:{self.event_type} ({self.external_event_id})'
