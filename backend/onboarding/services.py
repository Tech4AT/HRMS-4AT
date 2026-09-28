"""
Business logic shared between the HTTP views and the scheduled command
(`activate_due_onboarding`) — kept out of views.py so "HR clicks a button"
and "the daily scheduler finds it's Day 1" run the exact same code path,
not two copies that can drift.
"""
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from accounts.models import issue_password_setup_token
from audit.utils import write_audit
from documents.models import Document
from employees.models import Employee
from notifications.utils import send_html_email

from .esignature import get_signature_provider
from .exceptions import (
    InvalidOfferTokenError,
    OfferAlreadyAcceptedError,
    OfferAlreadyRejectedError,
    OfferExpiredError,
    OfferWorkflowError,
)
from .models import (
    BGV_FAILED,
    BGV_PASSED,
    BGV_PENDING_DOCUMENTS,
    BGV_READY_FOR_REVIEW,
    CATEGORY_PREBOARDING,
    OFFER_ACCEPTED,
    OFFER_AWAITING_SIGNATURE,
    OFFER_CANCELLED,
    OFFER_DRAFT,
    OFFER_EXPIRED,
    OFFER_GENERATED,
    OFFER_REJECTED,
    OFFER_REJECTION_REASON_CHOICES,
    OFFER_SENT,
    OFFER_SIGNABLE_STATUSES,
    OFFER_SIGNED,
    OFFER_VIEWED,
    OWNER_NEW_HIRE,
    STAGE_ONBOARDING,
    STAGE_PREBOARDING,
    TASK_DONE,
    TASK_PENDING,
    TASK_SKIPPED,
    BackgroundVerification,
    OfferLetter,
    OfferLetterTemplate,
    OnboardingProfile,
    OnboardingTask,
    OnboardingTaskTemplate,
    hash_signing_token,
)
from .offer_letter import render_offer_letter_pdf

# Valid offer status transitions (docs/REQUIREMENTS.md §18) — anything not
# listed here (REJECTED -> ACCEPTED, EXPIRED -> ACCEPTED, ACCEPTED ->
# REJECTED, ...) raises OfferWorkflowError instead of silently happening.
ALLOWED_OFFER_TRANSITIONS: dict[str, set[str]] = {
    OFFER_DRAFT: {OFFER_GENERATED, OFFER_CANCELLED},
    OFFER_GENERATED: {OFFER_GENERATED, OFFER_SENT, OFFER_CANCELLED},
    OFFER_SENT: {OFFER_AWAITING_SIGNATURE, OFFER_VIEWED, OFFER_SIGNED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_CANCELLED},
    OFFER_AWAITING_SIGNATURE: {OFFER_VIEWED, OFFER_SIGNED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_CANCELLED},
    OFFER_VIEWED: {OFFER_SIGNED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_CANCELLED},
    OFFER_SIGNED: {OFFER_ACCEPTED},
    OFFER_ACCEPTED: set(),
    OFFER_REJECTED: set(),
    OFFER_EXPIRED: {OFFER_AWAITING_SIGNATURE},  # HR-initiated resend only — see resend_offer_letter
    OFFER_CANCELLED: set(),
}


def _transition(offer: OfferLetter, new_status: str) -> None:
    allowed = ALLOWED_OFFER_TRANSITIONS.get(offer.status, set())
    if new_status not in allowed:
        raise OfferWorkflowError(f'Cannot move an offer from "{offer.status}" to "{new_status}".')
    offer.status = new_status


def generate_tasks_from_templates(profile: OnboardingProfile, category: str) -> None:
    """Copy every active template of `category` onto `profile` as concrete
    tasks, due-dated relative to the employee's joining date."""
    joining_date = profile.employee.joining_date
    templates = OnboardingTaskTemplate.objects.filter(is_active=True, category=category)
    existing_template_ids = set(
        profile.tasks.filter(template_id__isnull=False).values_list('template_id', flat=True)
    )
    tasks = [
        OnboardingTask(
            profile=profile,
            template=t,
            category=t.category,
            title=t.title,
            description=t.description,
            owner=t.owner,
            is_required=t.is_required,
            requires_document=t.requires_document,
            due_date=joining_date + timedelta(days=t.offset_days),
            sort_order=t.sort_order,
            assignee_id=t.assignee_id,
        )
        for t in templates
        if t.id not in existing_template_ids
    ]
    OnboardingTask.objects.bulk_create(tasks)
    # `profile.tasks` may already be prefetch-cached by the caller (e.g. a
    # queryset with prefetch_related('tasks')) — drop it so the newly
    # created rows show up on next access.
    if tasks and hasattr(profile, '_prefetched_objects_cache'):
        profile._prefetched_objects_cache.pop('tasks', None)
    if any(t.requires_document for t in tasks):
        refresh_background_verification_status(profile)
    for task in tasks:
        # Tasks the e-signature already proves done are auto-completed right
        # after generation — don't email an assignee about those.
        if task.assignee_id and task.title.strip().lower() not in _AUTO_COMPLETE_TASK_SOURCE:
            notify_task_assignee(task)


def notify_task_assignee(task: OnboardingTask) -> None:
    assignee = task.assignee
    if assignee is None or task.status in (TASK_DONE, TASK_SKIPPED):
        return
    new_hire = task.profile.employee
    send_html_email(
        assignee.work_email,
        f'Onboarding task for you: {task.title} — {new_hire.full_name}',
        'onboarding/emails/task_assigned.html',
        {
            'first_name': assignee.first_name,
            'task_title': task.title,
            'task_description': task.description,
            'employee_name': new_hire.full_name,
            'employee_code': new_hire.employee_code,
            'joining_date': new_hire.joining_date.strftime('%d %B %Y'),
            'due_date': task.due_date.strftime('%d %B %Y') if task.due_date else None,
        },
    )


# Preboarding-checklist titles that the e-signature workflow already proves
# true by the time these tasks first exist (task generation now happens at
# acceptance — see accept_offer — by which point the offer was necessarily
# already sent and signed). Matched case-insensitively against whatever HR
# named the template; nothing breaks if a template with this title doesn't
# exist, was renamed, or was removed — this just has nothing to match.
_AUTO_COMPLETE_TASK_SOURCE = {
    'send offer letter': lambda offer: offer.sent_at,
    'collect signed offer letter': lambda offer: offer.signed_at,
}


def _auto_complete_offer_proven_tasks(profile: OnboardingProfile, offer: OfferLetter) -> None:
    """Marks any freshly-generated preboarding task whose whole job was to
    manually confirm something the e-signature flow already recorded — so
    HR isn't asked to tick a box for an event the system already knows
    happened. `completed_by` stays null (system-derived, not an HR click),
    same convention as a scheduled command's audit entries."""
    tasks = list(profile.tasks.filter(status=TASK_PENDING))
    changed = []
    for task in tasks:
        get_completed_at = _AUTO_COMPLETE_TASK_SOURCE.get(task.title.strip().lower())
        if get_completed_at is None:
            continue
        completed_at = get_completed_at(offer)
        if completed_at is None:
            continue
        task.status = TASK_DONE
        task.completed_at = completed_at
        changed.append(task)
    if not changed:
        return
    OnboardingTask.objects.bulk_update(changed, ['status', 'completed_at'])
    if any(t.requires_document for t in changed) and hasattr(profile, '_prefetched_objects_cache'):
        profile._prefetched_objects_cache.pop('tasks', None)


def auto_complete_task_by_title(profile: OnboardingProfile, title: str, actor=None) -> None:
    """Generalized version of `_auto_complete_offer_proven_tasks` for
    triggers other than offer acceptance — e.g. the candidate submitting
    their bank details (see MyBankDetailsView) satisfies an "Add bank
    account details" checklist item the same way uploading a document
    satisfies a document-required one, just without a document. Matched
    case-insensitively; a no-op if no such pending task exists (template
    renamed/removed, or already done)."""
    task = profile.tasks.filter(title__iexact=title, status=TASK_PENDING).first()
    if task is None:
        return
    task.status = TASK_DONE
    task.completed_at = timezone.now()
    task.completed_by = actor
    task.save(update_fields=['status', 'completed_at', 'completed_by'])
    if task.requires_document:
        refresh_background_verification_status(profile, actor=actor)
    maybe_auto_activate(profile, actor=actor)


def activate_day1(profile: OnboardingProfile, actor=None, trigger: str | None = None) -> bool:
    """Flip the employee active, seed the onboarding-phase checklist, audit
    and notify. `actor=None` marks a system-triggered activation rather than
    an HR Admin clicking the button — audit log entries with a null actor
    are how you tell them apart later; `trigger` records *which* system
    path fired it (see `maybe_auto_activate` below and
    activate_due_onboarding.py), defaulting to the old two-way guess when a
    caller doesn't say.

    Guarded on the offer actually being ACCEPTED (docs/REQUIREMENTS.md §13:
    "Never mark the employee ACTIVE before the offer is signed") — without
    this, HR could hit "Mark Day 1 Complete" on a record whose candidate
    never responded (or declined), activating an employee who was never
    actually hired."""
    if profile.stage != STAGE_PREBOARDING:
        return False
    offer = profile.current_offer_letter
    if offer is None or offer.status != OFFER_ACCEPTED:
        return False

    employee = profile.employee
    employee.status = Employee.STATUS_ACTIVE
    employee.save(update_fields=['status'])

    profile.stage = STAGE_ONBOARDING
    profile.day1_completed_at = timezone.now()
    profile.save(update_fields=['stage', 'day1_completed_at'])

    generate_tasks_from_templates(profile, category='onboarding')

    write_audit(actor, 'onboarding.day1_activated', 'onboarding_profile', profile.id, {
        'employeeId': employee.id,
        'trigger': trigger or ('manual' if actor else 'scheduled'),
    })
    send_html_email(
        employee.work_email,
        'Welcome to Day 1! Your account is now active',
        'onboarding/emails/day1.html',
        {'first_name': employee.first_name, 'work_email': employee.work_email},
    )
    return True


def _preboarding_checklist_complete(profile: OnboardingProfile) -> bool:
    required = profile.tasks.filter(category=CATEGORY_PREBOARDING, is_required=True)
    if not required.exists():
        return False  # nothing generated yet (e.g. offer not accepted) — never auto-activate on an empty checklist
    return not required.exclude(status__in=(TASK_DONE, TASK_SKIPPED)).exists()


def maybe_auto_activate(profile: OnboardingProfile, actor=None) -> bool:
    """Converts preboarding -> onboarding automatically the instant every
    *required* preboarding task is done or skipped — a new hire who
    finishes their checklist early no longer has to wait for HR to click
    "Mark Day 1 Complete" or for the scheduled joining-date job
    (activate_due_onboarding.py, still the fallback for whoever *doesn't*
    finish early). Call this after anything that can complete the last
    outstanding required task: a task status change, a document-driven
    auto-complete, or the offer-acceptance task generation itself. Safe to
    call unconditionally — `activate_day1` already re-checks stage and
    offer status, so this is a no-op outside the exact moment the last
    required task closes."""
    if profile.stage != STAGE_PREBOARDING:
        return False
    if not _preboarding_checklist_complete(profile):
        return False
    return activate_day1(profile, actor=actor, trigger='checklist_complete')


def generate_offer_letter_document(offer: OfferLetter, actor) -> Document:
    """Render the PDF and (re)attach it as the offer's `documents.Document`.
    Safe to call again after the package changes while still a draft."""
    pdf_bytes = render_offer_letter_pdf(offer)
    filename = f'offer-letter-{offer.profile.employee.employee_code}.pdf'
    document = Document.objects.create(
        entity_type='offer_letter',
        entity_id=str(offer.id),
        employee=offer.profile.employee,
        file=ContentFile(pdf_bytes, name=filename),
        original_filename=filename,
        uploaded_by=actor,
    )
    offer.document = document
    offer.save(update_fields=['document'])
    return document


def resolve_offer_letter_template(template_id=None) -> OfferLetterTemplate | None:
    """The template HR picked, or the org's default, or None if neither
    exists yet (nothing seeded) — callers decide what None means for them."""
    if template_id:
        template = OfferLetterTemplate.objects.filter(pk=template_id, is_active=True).first()
        if template:
            return template
    return OfferLetterTemplate.objects.filter(is_active=True, is_default=True).first()


def create_offer_letter(profile: OnboardingProfile, *, basic_salary, hra, other_allowances, other_components,
                         currency, employment_type, probation_period_months, notice_period_days, created_by,
                         template=None) -> OfferLetter:
    """Called from new-hire creation — auto-generates the draft PDF
    immediately, from `template` (or the org's default). Never sends it; see
    `send_offer_letter`. `annual_ctc` is never passed in — it's always the
    sum of the four components (see OfferLetter.save()).

    If no template is available, or if the template file is missing/broken,
    the OfferLetter record is still created (status=draft, no document)
    so employee creation never fails because of a missing template."""
    import logging
    _log = logging.getLogger(__name__)

    if template is None:
        template = resolve_offer_letter_template()

    offer = OfferLetter.objects.create(
        profile=profile,
        template=template,
        basic_salary=basic_salary,
        hra=hra,
        other_allowances=other_allowances,
        other_components=other_components,
        currency=currency,
        employment_type=employment_type,
        probation_period_months=probation_period_months,
        notice_period_days=notice_period_days,
        created_by=created_by,
    )

    if template is None:
        _log.warning(
            'No offer letter template configured — OfferLetter %s created without PDF. '
            'Upload a template in Onboarding → Offer Letter Templates and mark it default.',
            offer.id,
        )
        return offer

    try:
        generate_offer_letter_document(offer, created_by)
        offer.status = OFFER_GENERATED
        offer.save(update_fields=['status'])
    except Exception:
        _log.exception(
            'PDF generation failed for OfferLetter %s (template %s missing or broken). '
            'The employee was created; HR can regenerate the offer letter once the template file is fixed.',
            offer.id, template.id,
        )
        return offer

    write_audit(created_by, 'onboarding.offer_letter_generated', 'offer_letter', offer.id, {
        'employeeId': profile.employee_id,
        'templateId': template.id if template else None,
    })
    return offer


def _signing_url(raw_token: str) -> str:
    return f'{settings.FRONTEND_ORIGIN.rstrip("/")}/offer/{raw_token}'


def _email_offer_to_candidate(offer: OfferLetter, raw_token: str, *, resend: bool) -> None:
    employee = offer.profile.employee
    with offer.document.file.open('rb') as f:
        pdf_bytes = f.read()
    designation = employee.designation.name if employee.designation else 'New Role'
    subject = f'{"Reminder: your" if resend else "Your"} Offer Letter — {designation}'

    send_html_email(
        employee.personal_email or employee.work_email,
        subject,
        'onboarding/emails/offer_letter.html',
        {
            'first_name': employee.first_name,
            'designation': employee.designation.name if employee.designation else None,
            'department': employee.department.name if employee.department else None,
            'joining_date': employee.joining_date.strftime('%d %B %Y'),
            'signing_url': _signing_url(raw_token),
            'expires_at': offer.expires_at.strftime('%d %B %Y') if offer.expires_at else None,
            'resend': resend,
        },
        attachment=(offer.document.original_filename, pdf_bytes, 'application/pdf'),
    )


def _notify_hr(profile: OnboardingProfile, template: str, subject: str, extra: dict | None = None) -> None:
    hr_admin = profile.created_by
    recipient = getattr(hr_admin, 'email', None)
    if not recipient:
        return
    send_html_email(recipient, subject, template, {
        'hr_first_name': (hr_admin.first_name or hr_admin.get_username()),
        'employee_name': profile.employee.full_name,
        'employee_code': profile.employee.employee_code,
        **(extra or {}),
    })


def send_offer_letter(offer: OfferLetter, actor, *, ttl_hours: int | None = None) -> str:
    """First send only (see `resend_offer_letter` for re-sends). Issues a
    fresh single-use signing token, emails the candidate a secure link (never
    a guessable `/offer/<id>` — docs/REQUIREMENTS.md §5) plus the PDF, and
    moves the offer to AWAITING_SIGNATURE. Returns the raw token (tests/admin
    tooling only — normal callers don't need it, the email already has the
    link; nothing else ever sees or stores it in cleartext)."""
    if offer.status not in (OFFER_DRAFT, OFFER_GENERATED):
        raise OfferWorkflowError('This offer has already been sent.')
    if not offer.document:
        generate_offer_letter_document(offer, actor)

    ttl_hours = ttl_hours or settings.OFFER_SIGNING_TOKEN_TTL_HOURS
    raw_token = offer.issue_signing_token(ttl_hours=ttl_hours)
    offer.expires_at = offer.signing_token_expires_at
    _transition(offer, OFFER_SENT)
    offer.sent_at = timezone.now()
    _transition(offer, OFFER_AWAITING_SIGNATURE)
    offer.save()

    _email_offer_to_candidate(offer, raw_token, resend=False)
    write_audit(actor, 'onboarding.offer_sent', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
    return raw_token


def resend_offer_letter(offer: OfferLetter, actor, *, ttl_hours: int | None = None) -> str:
    """HR-triggered re-send: a fresh token/expiry (the old link stops working
    immediately), same offer version. Valid from any pending or expired
    state — an EXPIRED offer can be revived this way without creating a new
    version (nothing about its terms changed, only the deadline)."""
    if offer.status not in OFFER_SIGNABLE_STATUSES and offer.status != OFFER_EXPIRED:
        raise OfferWorkflowError('Only a pending or expired offer can be resent.')

    ttl_hours = ttl_hours or settings.OFFER_SIGNING_TOKEN_TTL_HOURS
    raw_token = offer.issue_signing_token(ttl_hours=ttl_hours)
    offer.expires_at = offer.signing_token_expires_at
    if offer.status == OFFER_EXPIRED:
        offer.status = OFFER_AWAITING_SIGNATURE  # explicit HR override, not a candidate-driven transition
    offer.save()

    _email_offer_to_candidate(offer, raw_token, resend=True)
    write_audit(actor, 'onboarding.offer_resent', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
    return raw_token


def cancel_offer_letter(offer: OfferLetter, actor) -> OfferLetter:
    """HR-initiated withdrawal — the "undo" for a Send/Resend done by
    mistake (wrong candidate, wrong package, sent too early, ...). Valid
    from any non-terminal status, including DRAFT/GENERATED (withdrawing a
    hire before ever sending it). Unlike `create_new_offer_version`, this
    does **not** create a replacement — it just stops this offer; the
    signing link (if any was issued) dies immediately, matching
    `resolve_offer_by_token`'s existing "dead token -> 404" behavior, so a
    candidate who already has the email sees "invalid or expired" rather
    than being able to sign a withdrawn offer. HR can still edit a
    cancelled offer afterward (that routes through create_new_offer_version
    and produces a fresh version to send) if they want to try again with
    this candidate."""
    if offer.status in (OFFER_ACCEPTED, OFFER_REJECTED, OFFER_EXPIRED, OFFER_CANCELLED):
        raise OfferWorkflowError(f'This offer is already {offer.get_status_display().lower()} and cannot be cancelled.')

    _transition(offer, OFFER_CANCELLED)
    offer.cancelled_at = timezone.now()
    offer.invalidate_signing_token()
    offer.save()

    write_audit(actor, 'onboarding.offer_cancelled', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
    return offer


def extend_offer_letter(offer: OfferLetter, actor, *, additional_hours: int) -> OfferLetter:
    """Pushes the signing deadline out without changing the terms or
    inviting the candidate to re-review anything — no new version, no new
    email. Never automatic (docs/REQUIREMENTS.md §9): always an explicit HR
    action."""
    if offer.status not in OFFER_SIGNABLE_STATUSES:
        raise OfferWorkflowError('Only a pending offer can be extended.')

    base = offer.signing_token_expires_at or timezone.now()
    if base < timezone.now():
        base = timezone.now()
    offer.signing_token_expires_at = base + timedelta(hours=additional_hours)
    offer.expires_at = offer.signing_token_expires_at
    offer.save(update_fields=['signing_token_expires_at', 'expires_at'])

    write_audit(actor, 'onboarding.offer_extended', 'offer_letter', offer.id, {
        'employeeId': offer.profile.employee_id, 'newExpiresAt': offer.expires_at.isoformat(),
    })
    return offer


@transaction.atomic
def create_new_offer_version(offer: OfferLetter, actor, **field_updates) -> OfferLetter:
    """HR edited an offer that's already out for signature (docs/REQUIREMENTS.md
    §11) — never mutate a version the candidate may already have open in
    their browser. Supersedes `offer` (cancels it, invalidates its token —
    that link now 404s), and returns a fresh v(n+1) in GENERATED status; HR
    must explicitly send it, same as the very first version (editing never
    auto-sends)."""
    if offer.status == OFFER_ACCEPTED:
        raise OfferWorkflowError('This offer has already been accepted and can no longer be edited.')

    superseding_a_sent_offer = offer.status not in (OFFER_DRAFT, OFFER_GENERATED)
    if superseding_a_sent_offer:
        offer.status = OFFER_CANCELLED
        offer.cancelled_at = timezone.now()
    offer.is_current = False
    offer.invalidate_signing_token()
    offer.save()

    new_offer = OfferLetter.objects.create(
        profile=offer.profile,
        offer_number=offer.offer_number,
        version=offer.version + 1,
        is_current=True,
        previous_version=offer,
        template=field_updates.get('template', offer.template),
        basic_salary=field_updates.get('basic_salary', offer.basic_salary),
        hra=field_updates.get('hra', offer.hra),
        other_allowances=field_updates.get('other_allowances', offer.other_allowances),
        other_components=field_updates.get('other_components', offer.other_components),
        currency=field_updates.get('currency', offer.currency),
        employment_type=field_updates.get('employment_type', offer.employment_type),
        probation_period_months=field_updates.get('probation_period_months', offer.probation_period_months),
        notice_period_days=field_updates.get('notice_period_days', offer.notice_period_days),
        created_by=actor,
    )
    generate_offer_letter_document(new_offer, actor)
    new_offer.status = OFFER_GENERATED
    new_offer.save(update_fields=['status'])

    write_audit(actor, 'onboarding.offer_version_created', 'offer_letter', new_offer.id, {
        'employeeId': offer.profile.employee_id, 'previousVersion': offer.version, 'newVersion': new_offer.version,
    })
    return new_offer


def offers_awaiting_signature():
    return OfferLetter.objects.filter(status__in=OFFER_SIGNABLE_STATUSES, is_current=True)


def resolve_offer_by_token(raw_token: str) -> OfferLetter:
    """The *only* way anything candidate-facing ever finds an offer — no
    guessable `/offer/<id>` route (docs/REQUIREMENTS.md §5). Matches only the
    current version, so a link to a since-superseded version 404s exactly
    like a wrong token would — a stale link never leaks even the existence
    of a newer version."""
    if not raw_token:
        raise InvalidOfferTokenError()
    token_hash = hash_signing_token(raw_token)
    offer = (
        OfferLetter.objects
        .select_related(
            'profile', 'profile__employee', 'profile__employee__department', 'profile__employee__designation',
        )
        .filter(signing_token_hash=token_hash, is_current=True)
        .first()
    )
    if offer is None:
        raise InvalidOfferTokenError()
    return offer


def _expire(offer: OfferLetter) -> None:
    _transition(offer, OFFER_EXPIRED)
    offer.invalidate_signing_token()
    offer.save(update_fields=['status', 'signing_token_hash', 'signing_token_expires_at'])
    write_audit(None, 'onboarding.offer_expired', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
    profile = offer.profile
    _notify_hr(profile, 'onboarding/emails/hr_offer_expired.html', f'Offer expired — {profile.employee.full_name}')


def send_offer_expiry_reminder(offer: OfferLetter) -> bool:
    """Called by the daily `send_offer_expiry_reminders` command for an
    offer whose token expires within the reminder window. Reissues a fresh
    token pinned to the *same* `expires_at` (the old, already-delivered link
    stops working, but the deadline itself never moves just because a
    reminder went out — docs/REQUIREMENTS.md §9 forbids silent auto-extension).
    Sent at most once per offer version — idempotency here is a plain
    AuditLog existence check (docs/ARCHITECTURE.md primitive #4 is already
    the record of what was sent, no separate flag needed)."""
    from audit.models import AuditLog

    already_sent = AuditLog.objects.filter(
        action='onboarding.offer_expiry_reminder_sent', entity_type='offer_letter', entity_id=str(offer.id),
    ).exists()
    if already_sent:
        return False

    raw_token = offer.issue_signing_token(expires_at=offer.expires_at)
    offer.save(update_fields=['signing_token_hash', 'signing_token_expires_at'])

    employee = offer.profile.employee
    send_html_email(
        employee.personal_email or employee.work_email,
        f'Reminder: your offer letter expires soon — {settings.COMPANY_NAME}',
        'onboarding/emails/offer_expiry_reminder.html',
        {
            'first_name': employee.first_name,
            'designation': employee.designation.name if employee.designation else 'your role',
            'expires_at': offer.expires_at.strftime('%d %B %Y') if offer.expires_at else None,
            'signing_url': _signing_url(raw_token),
        },
    )
    write_audit(None, 'onboarding.offer_expiry_reminder_sent', 'offer_letter', offer.id, {
        'employeeId': offer.profile.employee_id,
    })
    return True


def mark_offer_expired_if_due(offer: OfferLetter) -> OfferLetter:
    """Lazy expiry — checked whenever a token is resolved, plus swept by the
    `expire_pending_offers` scheduled command so HR's dashboard reflects
    EXPIRED even for an offer nobody ever tried to open again."""
    if offer.status in OFFER_SIGNABLE_STATUSES and offer.is_token_expired:
        _expire(offer)
    return offer


def mark_offer_viewed(offer: OfferLetter) -> OfferLetter:
    """First-open tracking only — never blocks or advances anything else.
    SENT/AWAITING_SIGNATURE -> VIEWED (send_offer_letter moves straight to
    AWAITING_SIGNATURE — see its docstring — so that's the status this
    almost always fires from) so HR can tell "never opened" from "opened,
    still deciding"; an already-VIEWED offer just gets a fresh audit entry
    for each subsequent open, without changing status again."""
    first_view = offer.viewed_at is None
    if first_view:
        offer.viewed_at = timezone.now()
    if offer.status in (OFFER_SENT, OFFER_AWAITING_SIGNATURE):
        offer.status = OFFER_VIEWED
        offer.save(update_fields=['viewed_at', 'status'])
    elif first_view:
        offer.save(update_fields=['viewed_at'])
    if first_view:
        write_audit(None, 'onboarding.offer_viewed', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
    return offer


def _lock_offer_and_check_signable(offer_id: int, *, idempotent_status: str):
    """Row-locks the offer and validates it's still in a signable state,
    lazily expiring it first if its token is past due. Deliberately its own
    transaction, separate from the caller's (accept_offer/reject_offer's)
    transaction: if this ends up calling `_expire()`, that write has to
    survive even though the caller is about to raise `OfferExpiredError` —
    raising inside the *same* atomic block that wrote the expiry would roll
    the expiry back along with it (Django rolls back the whole atomic block
    an exception escapes from, not just the exception's own statement).
    `idempotent_status` is the status this particular action is allowed to
    already be in (ACCEPTED for accept_offer, REJECTED for reject_offer) —
    that case returns the offer with no error; the *other* terminal status
    is always a genuine conflict."""
    with transaction.atomic():
        offer = (
            OfferLetter.objects
            .select_for_update()
            .select_related('profile', 'profile__employee')
            .get(pk=offer_id)
        )
        if offer.status == idempotent_status:
            return offer, None
        if offer.status == OFFER_ACCEPTED:
            return None, OfferAlreadyAcceptedError()
        if offer.status == OFFER_REJECTED:
            return None, OfferAlreadyRejectedError()
        if offer.status == OFFER_EXPIRED:
            return None, OfferExpiredError()
        if offer.status not in OFFER_SIGNABLE_STATUSES:
            return None, OfferWorkflowError('This offer is not currently awaiting a response.')
        if offer.is_token_expired:
            _expire(offer)
            return None, OfferExpiredError()
        return offer, None


def accept_offer(offer_id: int, *, typed_name: str | None = None, agreed: bool = False,
                  ip_address: str | None = None, user_agent: str = '', actor=None, signature=None) -> OfferLetter:
    """The one and only path from AWAITING_SIGNATURE to preboarding
    (docs/REQUIREMENTS.md §12, §22). Row-locked and idempotent: a duplicate
    accept (double-click, a retried webhook) on an already-ACCEPTED offer is
    a silent no-op success, not an error — see §17.

    Two calling conventions:
    - The synchronous, in-app path (views_public.py): pass `typed_name`/
      `agreed`/`ip_address`/`user_agent`; this calls the configured
      provider's `capture_signature()` to turn them into a `SignatureResult`.
    - The async webhook path (webhooks.py): pass an already-built
      `signature` (an `esignature.SignatureResult`) directly and skip
      `capture_signature()` entirely — an async vendor captured the
      signature on *their* platform already; calling our own provider's
      capture step again would be meaningless (and `InAppSignatureProvider`
      isn't even the configured provider in that scenario).

    Deliberately *not* one single `@transaction.atomic` function — see
    `_lock_offer_and_check_signable`'s docstring for why the lazy-expiry
    check has to be its own transaction. The actual mutation below (from the
    re-lock onward) is its own atomic block: it either all happens or none
    of it does.
    """
    offer, error = _lock_offer_and_check_signable(offer_id, idempotent_status=OFFER_ACCEPTED)
    if error:
        raise error
    if offer.status == OFFER_ACCEPTED:
        return offer

    if signature is None:
        if not agreed:
            raise OfferWorkflowError('You must confirm you have read and agree to the terms of this offer.')
        typed_name = (typed_name or '').strip()
        if not typed_name:
            raise OfferWorkflowError('Type your full name to sign.')
        provider = get_signature_provider()
        signature = provider.capture_signature(typed_name=typed_name, ip_address=ip_address, user_agent=user_agent)

    with transaction.atomic():
        # Re-lock: typed_name/agree validation above happens outside a lock
        # (nothing to protect there), so re-fetch-under-lock immediately
        # before the actual state mutation, in case something changed since
        # the check phase above.
        offer = OfferLetter.objects.select_for_update().select_related('profile', 'profile__employee').get(pk=offer_id)
        if offer.status == OFFER_ACCEPTED:
            return offer
        if offer.status not in OFFER_SIGNABLE_STATUSES:
            raise OfferWorkflowError('This offer changed state while you were signing — please reload and try again.')

        now = timezone.now()
        _transition(offer, OFFER_SIGNED)
        offer.signed_at = now
        offer.signature_name = signature.signature_name
        offer.signature_ip = signature.ip_address
        offer.signature_user_agent = signature.user_agent
        _transition(offer, OFFER_ACCEPTED)
        offer.accepted_at = now
        offer.invalidate_signing_token()
        offer.save()

        # Re-render now that offer.signature_name/signed_at are set — the
        # PDF a candidate reviewed pre-signature never shows a signature
        # block; this is the *only* version that does, and it's what ends
        # up in "My Documents" / the HR record from this point on (see
        # offer_letter.py::_render_text_template_pdf).
        generate_offer_letter_document(offer, actor=actor)

        write_audit(actor, 'onboarding.offer_signed', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})
        write_audit(actor, 'onboarding.offer_accepted', 'offer_letter', offer.id, {'employeeId': offer.profile.employee_id})

        profile = offer.profile
        generate_tasks_from_templates(profile, category=CATEGORY_PREBOARDING)
        _auto_complete_offer_proven_tasks(profile, offer)
        write_audit(actor, 'onboarding.preboarding_started', 'onboarding_profile', profile.id, {
            'employeeId': profile.employee_id,
        })

    employee = profile.employee
    send_html_email(
        employee.personal_email or employee.work_email,
        'You accepted your offer — welcome to the team!',
        'onboarding/emails/offer_accepted_candidate.html',
        {'first_name': employee.first_name},
    )

    # The account created at new-hire time (CreateNewHireSerializer) got a
    # random, never-communicated password — this link is the only real way
    # in. Without it, "log in and see your checklist" (the whole point of
    # the email below) is a dead end.
    set_password_url = None
    if employee.user_id:
        raw_token = issue_password_setup_token(employee.user, ttl_hours=settings.PASSWORD_SETUP_TOKEN_TTL_HOURS)
        set_password_url = f'{settings.FRONTEND_ORIGIN.rstrip("/")}/set-password/{raw_token}'

    next_steps = new_hire_outstanding_tasks(profile)
    send_html_email(
        employee.personal_email or employee.work_email,
        'Welcome aboard! A few quick steps before you join',
        'onboarding/emails/welcome.html',
        {
            'first_name': employee.first_name,
            'joining_date': employee.joining_date.strftime('%d %B %Y'),
            'pending_count': len(next_steps),
            'tasks': next_steps,
            'set_password_url': set_password_url,
            'work_email': employee.work_email,
        },
    )
    _notify_hr(
        profile, 'onboarding/emails/hr_offer_accepted.html', f'Offer accepted — {employee.full_name}',
    )
    # Covers the (unusual but possible) case where every *required*
    # preboarding task was one of the offer-proven ones above — nothing
    # left for the candidate to do, so there's no later task-completion
    # event to trigger this from.
    maybe_auto_activate(profile, actor=actor)
    return offer


def reject_offer(offer_id: int, *, reason: str, comments: str, ip_address: str | None = None,
                  user_agent: str = '', actor=None) -> OfferLetter:
    """Rejection stops the workflow permanently: REJECTED is terminal (see
    ALLOWED_OFFER_TRANSITIONS), no preboarding tasks are created (they never
    exist until `accept_offer` creates them), and the Employee/User row
    created at new-hire time is marked `offer_declined` so it can never be
    activated. Idempotent like `accept_offer`: a duplicate reject on an
    already-REJECTED offer is a silent no-op success. See `accept_offer`'s
    docstring for why this isn't one single `@transaction.atomic` function."""
    offer, error = _lock_offer_and_check_signable(offer_id, idempotent_status=OFFER_REJECTED)
    if error:
        raise error
    if offer.status == OFFER_REJECTED:
        return offer

    valid_reasons = dict(OFFER_REJECTION_REASON_CHOICES)
    if reason not in valid_reasons:
        raise OfferWorkflowError('Choose a valid rejection reason.')

    with transaction.atomic():
        offer = OfferLetter.objects.select_for_update().select_related('profile', 'profile__employee').get(pk=offer_id)
        if offer.status == OFFER_REJECTED:
            return offer
        if offer.status not in OFFER_SIGNABLE_STATUSES:
            raise OfferWorkflowError('This offer changed state — please reload and try again.')

        _transition(offer, OFFER_REJECTED)
        offer.rejected_at = timezone.now()
        offer.rejection_reason = reason
        offer.rejection_comments = (comments or '').strip()
        offer.invalidate_signing_token()
        offer.save()

        write_audit(actor, 'onboarding.offer_rejected', 'offer_letter', offer.id, {
            'employeeId': offer.profile.employee_id, 'reason': reason,
        })

        profile = offer.profile
        employee = profile.employee
        employee.status = Employee.STATUS_OFFER_DECLINED
        employee.save(update_fields=['status'])

    _notify_hr(
        profile, 'onboarding/emails/hr_offer_rejected.html', f'Offer declined — {employee.full_name}',
        {'reason': valid_reasons.get(reason, reason)},
    )
    return offer


def new_hire_outstanding_tasks(profile: OnboardingProfile) -> list[dict]:
    """The new hire's own open steps, as email-template context — shared by
    the welcome email and the daily reminder so both list the same things."""
    today = timezone.localdate()
    return [
        {
            'title': t.title,
            'due_date': t.due_date.strftime('%d %b %Y') if t.due_date else None,
            'overdue': bool(t.due_date and t.due_date < today),
            'requires_document': t.requires_document,
        }
        for t in profile.tasks
        .filter(owner=OWNER_NEW_HIRE)
        .exclude(status__in=[TASK_DONE, TASK_SKIPPED])
        .order_by('due_date', 'sort_order')
    ]


def send_task_reminder(profile: OnboardingProfile) -> bool:
    """Emails the new hire a checklist of their own outstanding tasks.
    Called by the daily `send_onboarding_reminders` command — naturally
    stops once every new-hire-owned task is done/skipped (no outstanding
    tasks left to list) or the record reaches STAGE_COMPLETED, satisfying
    'remind them until the process completes' without any separate
    on/off flag to track."""
    task_context = new_hire_outstanding_tasks(profile)
    if not task_context:
        return False
    outstanding = task_context

    employee = profile.employee
    required = [t for t in profile.tasks.all() if t.is_required]
    done = sum(1 for t in required if t.status == TASK_DONE)
    percent = round(done / len(required) * 100) if required else 100

    send_html_email(
        employee.personal_email or employee.work_email,
        f'{len(outstanding)} onboarding step{"s" if len(outstanding) != 1 else ""} still open',
        'onboarding/emails/task_reminder.html',
        {
            'first_name': employee.first_name,
            'tasks': task_context,
            'done_count': done,
            'total_count': len(required),
            'percent': percent,
        },
    )
    write_audit(None, 'onboarding.reminder_sent', 'onboarding_profile', profile.id, {
        'employeeId': employee.id, 'outstandingCount': len(outstanding),
    })
    return True


def refresh_background_verification_status(profile: OnboardingProfile, actor=None) -> BackgroundVerification | None:
    """Auto-advance the verification record as document-backed tasks come
    in — called after every task status change. Never touches a record HR
    has already decided (passed/failed): that judgment call is theirs, not
    something a document count can overrule. Returns None if there's
    nothing to verify (no document-backed tasks on this profile)."""
    doc_tasks = [t for t in profile.tasks.all() if t.requires_document]
    if not doc_tasks:
        return None

    bgv, _created = BackgroundVerification.objects.get_or_create(profile=profile)
    if bgv.status in (BGV_PASSED, BGV_FAILED):
        return bgv

    all_submitted = all(t.status == TASK_DONE for t in doc_tasks)
    new_status = BGV_READY_FOR_REVIEW if all_submitted else BGV_PENDING_DOCUMENTS
    if new_status == bgv.status:
        return bgv

    bgv.status = new_status
    if new_status == BGV_READY_FOR_REVIEW:
        bgv.ready_at = timezone.now()
        bgv.save(update_fields=['status', 'ready_at'])
        write_audit(actor, 'onboarding.bgv_ready_for_review', 'background_verification', bgv.id, {
            'employeeId': profile.employee_id,
        })
        hr_admin = profile.created_by
        recipient = getattr(hr_admin, 'email', None)
        if recipient:
            send_html_email(
                recipient,
                f'Ready for review: background verification — {profile.employee.full_name}',
                'onboarding/emails/bgv_ready.html',
                {
                    'hr_first_name': hr_admin.first_name or hr_admin.get_username(),
                    'employee_name': profile.employee.full_name,
                    'employee_code': profile.employee.employee_code,
                    'document_count': len(doc_tasks),
                },
            )
    else:
        bgv.save(update_fields=['status'])
        write_audit(actor, 'onboarding.bgv_pending_documents', 'background_verification', bgv.id, {
            'employeeId': profile.employee_id,
        })
    return bgv


def build_documents_zip(profile: OnboardingProfile) -> bytes:
    """Bundles every document a new hire has submitted against their
    onboarding tasks into one ZIP, in-memory — the "one click" HR asked
    for instead of opening each document individually."""
    import io
    import zipfile

    task_ids = [str(t.id) for t in profile.tasks.all()]
    documents = Document.objects.filter(entity_type='onboarding_task', entity_id__in=task_ids).select_related(None)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        used_names = set()
        for doc in documents:
            name = doc.original_filename or f'document-{doc.id}'
            if name in used_names:
                stem, dot, ext = name.rpartition('.')
                name = f'{stem or name}-{doc.id}{dot}{ext}'
            used_names.add(name)
            with doc.file.open('rb') as f:
                zf.writestr(name, f.read())
    return buffer.getvalue()


def resolve_document_folder_entity(
    profile: OnboardingProfile | None, employee, title: str, fallback_entity_type: str,
) -> tuple[str, str]:
    """Which `documents.Document` bucket (entity_type, entity_id) a "My
    Documents" folder reads/writes against for one employee — today, purely
    "does a pending-task template with this exact title exist" (see
    MyDocumentsOverviewView). This is deliberately the *only* place that
    question gets asked, so a future requirement engine (department/role/
    employment-type/location-driven, per docs/REQUIREMENTS.md's open
    question on document requirements) has one seam to extend instead of
    several call sites to hunt down — e.g. swapping the `profile.tasks.filter`
    lookup below for a `DocumentRequirement.objects.for_employee(employee)`
    resolver, without touching MyDocumentsOverviewView or the frontend at
    all. Not built now — deliberately kept to the single case that exists
    today (a checklist template title match) rather than speculatively
    generalized ahead of an actual second use case.
    """
    task = profile.tasks.filter(title__iexact=title).first() if profile else None
    if task is not None:
        return 'onboarding_task', str(task.id)
    return fallback_entity_type, str(employee.id)
