from django.core.management.base import BaseCommand
from django.utils import timezone

from onboarding import services

# Run this daily. Reminds every candidate whose offer expires within the
# next REMINDER_WINDOW_HOURS and hasn't already been reminded (see
# services.send_offer_expiry_reminder for the one-reminder-per-version rule).
REMINDER_WINDOW_HOURS = 48


class Command(BaseCommand):
    help = "Email candidates whose offer's signing deadline is within 48 hours."

    def handle(self, *args, **options):
        cutoff = timezone.now() + timezone.timedelta(hours=REMINDER_WINDOW_HOURS)
        offers = (
            services.offers_awaiting_signature()
            .filter(signing_token_expires_at__isnull=False, signing_token_expires_at__lte=cutoff)
            .select_related('profile', 'profile__employee')
        )

        reminded = 0
        for offer in offers:
            offer = services.mark_offer_expired_if_due(offer)
            if offer.status not in services.OFFER_SIGNABLE_STATUSES:
                continue
            if services.send_offer_expiry_reminder(offer):
                reminded += 1
                self.stdout.write(f'Reminded {offer.profile.employee.full_name} ({offer.offer_number})')

        self.stdout.write(self.style.SUCCESS(f'{reminded} expiry reminder(s) sent.'))
