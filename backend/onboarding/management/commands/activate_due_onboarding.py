from django.core.management.base import BaseCommand
from django.utils import timezone

from onboarding import services
from onboarding.models import STAGE_PREBOARDING, OnboardingProfile

# Run this once a day (Windows Task Scheduler / cron — see backend/README.md).
# Deliberately a plain scheduled command, not a message queue or background
# worker (docs/ARCHITECTURE.md "Explicitly not being built") — it calls the
# exact same services.activate_day1() the "Mark Day 1 Complete" button calls,
# with actor=None so the audit log records it as system-triggered.


class Command(BaseCommand):
    help = "Auto-activate any new hire whose joining date has arrived (flips them active, seeds the onboarding checklist)."

    def handle(self, *args, **options):
        today = timezone.localdate()
        due = OnboardingProfile.objects.select_related('employee').filter(
            stage=STAGE_PREBOARDING,
            employee__joining_date__lte=today,
        )

        activated = 0
        for profile in due:
            if services.activate_day1(profile, actor=None):
                activated += 1
                self.stdout.write(f'Activated {profile.employee.full_name} ({profile.employee.employee_code})')

        self.stdout.write(self.style.SUCCESS(f'{activated} onboarding record(s) auto-activated.'))
