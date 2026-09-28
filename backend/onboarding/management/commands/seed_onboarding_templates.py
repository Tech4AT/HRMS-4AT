from django.core.management.base import BaseCommand

from onboarding.models import (
    CATEGORY_ONBOARDING,
    CATEGORY_PREBOARDING,
    OWNER_HR_ADMIN,
    OWNER_MANAGER,
    OWNER_NEW_HIRE,
    OnboardingTaskTemplate,
)

# offset_days is relative to joining_date: negative = before Day 1.
DEFAULT_TEMPLATES = [
    # --- Preboarding: offer accepted -> Day 1 ---
    (CATEGORY_PREBOARDING, 'Send offer letter', OWNER_HR_ADMIN, True, True, -14, 10),
    (CATEGORY_PREBOARDING, 'Collect signed offer letter', OWNER_NEW_HIRE, True, True, -10, 20),
    (CATEGORY_PREBOARDING, 'Submit ID proof', OWNER_NEW_HIRE, True, True, -7, 30),
    (CATEGORY_PREBOARDING, 'Submit educational certificates', OWNER_NEW_HIRE, True, True, -7, 40),
    (CATEGORY_PREBOARDING, 'Submit previous employment documents', OWNER_NEW_HIRE, False, True, -7, 50),
    # requires_document=False: this is a data form (see
    # onboarding/views.py::MyBankDetailsView), not a file upload — completed
    # automatically the moment the candidate submits it, same as the two
    # offer-proven tasks above (see services.auto_complete_task_by_title).
    (CATEGORY_PREBOARDING, 'Add bank account details', OWNER_NEW_HIRE, True, False, -7, 45),
    # No manual "Complete background verification" checkbox here — the
    # BackgroundVerification record tracks that automatically from the
    # three Submit-* document tasks above (see
    # services.refresh_background_verification_status).
    (CATEGORY_PREBOARDING, 'Provision laptop & accounts', OWNER_HR_ADMIN, True, False, -2, 70),
    (CATEGORY_PREBOARDING, 'Assign onboarding buddy', OWNER_HR_ADMIN, True, False, -2, 80),
    (CATEGORY_PREBOARDING, 'Send Day 1 joining instructions', OWNER_HR_ADMIN, True, False, -1, 90),
    # A plain acknowledgment, not a file upload (requires_document=False) —
    # completed by a "Mark as done" click, same as "Provision laptop &
    # accounts" above. Its onboarding-stage counterpart below already
    # existed; this preboarding one covers policies a candidate should
    # read *before* Day 1, not just after.
    (CATEGORY_PREBOARDING, 'Acknowledge company policies', OWNER_NEW_HIRE, True, False, -3, 85),
    # --- Onboarding: Day 1 -> first weeks ---
    (CATEGORY_ONBOARDING, 'Welcome & orientation session', OWNER_HR_ADMIN, True, False, 0, 10),
    (CATEGORY_ONBOARDING, 'Collect laptop & access badge', OWNER_NEW_HIRE, True, False, 0, 20),
    (CATEGORY_ONBOARDING, 'Complete IT security & policy acknowledgement', OWNER_NEW_HIRE, True, True, 1, 30),
    (CATEGORY_ONBOARDING, 'Meet your manager (1:1)', OWNER_MANAGER, True, False, 1, 40),
    (CATEGORY_ONBOARDING, 'Meet your buddy', OWNER_NEW_HIRE, False, False, 1, 50),
    (CATEGORY_ONBOARDING, 'Team introduction', OWNER_MANAGER, True, False, 2, 60),
    (CATEGORY_ONBOARDING, 'Complete mandatory compliance training', OWNER_NEW_HIRE, True, False, 7, 70),
    (CATEGORY_ONBOARDING, 'Set 30-day goals with manager', OWNER_MANAGER, True, False, 14, 80),
    (CATEGORY_ONBOARDING, '30-day check-in', OWNER_HR_ADMIN, True, False, 30, 90),
]


class Command(BaseCommand):
    help = 'Idempotently seed the default preboarding/onboarding checklist templates.'

    def handle(self, *args, **options):
        created = 0
        for category, title, owner, required, requires_doc, offset, sort_order in DEFAULT_TEMPLATES:
            _, was_created = OnboardingTaskTemplate.objects.get_or_create(
                category=category,
                title=title,
                defaults={
                    'owner': owner,
                    'is_required': required,
                    'requires_document': requires_doc,
                    'offset_days': offset,
                    'sort_order': sort_order,
                    'is_active': True,
                },
            )
            created += was_created
        self.stdout.write(self.style.SUCCESS(f'Seeded {created} new onboarding templates ({len(DEFAULT_TEMPLATES)} total defined).'))
