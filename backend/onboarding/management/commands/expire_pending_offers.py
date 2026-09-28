from django.core.management.base import BaseCommand

from onboarding import services

# Run this daily (Windows Task Scheduler / cron — see backend/README.md,
# alongside activate_due_onboarding/send_onboarding_reminders). Expiry is
# also checked lazily whenever a candidate's token is resolved
# (services.mark_offer_expired_if_due), but an offer nobody ever tries to
# open again would otherwise sit at AWAITING_SIGNATURE on HR's dashboard
# forever — this sweep is what actually flips it to EXPIRED.


class Command(BaseCommand):
    help = 'Expire any offer letter whose signing token has passed its deadline.'

    def handle(self, *args, **options):
        expired = 0
        for offer in services.offers_awaiting_signature().select_related('profile', 'profile__employee'):
            before = offer.status
            services.mark_offer_expired_if_due(offer)
            if offer.status != before:
                expired += 1
                self.stdout.write(f'Expired offer {offer.offer_number} for {offer.profile.employee.full_name}')

        self.stdout.write(self.style.SUCCESS(f'{expired} offer(s) expired.'))
