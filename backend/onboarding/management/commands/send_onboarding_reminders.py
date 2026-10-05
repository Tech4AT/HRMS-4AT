from django.core.management.base import BaseCommand

from onboarding import services
from onboarding.models import STAGE_COMPLETED, OnboardingProfile

# Run this once a day (Windows Task Scheduler / cron — see backend/README.md,
# alongside activate_due_onboarding). Each run emails every new hire who
# still has open steps a short reminder — see services.send_task_reminder for
# why this needs no separate "have we already reminded them" flag: it just
# naturally has nothing to send once they're done.


class Command(BaseCommand):
    help = 'Email every new hire with outstanding onboarding steps a reminder checklist.'

    def handle(self, *args, **options):
        profiles = (
            OnboardingProfile.objects
            .exclude(stage=STAGE_COMPLETED)
            .select_related('employee')
            .prefetch_related('tasks')
        )

        reminded = 0
        for profile in profiles:
            if services.send_task_reminder(profile):
                reminded += 1
                self.stdout.write(f'Reminded {profile.employee.full_name} ({profile.employee.employee_code})')

        self.stdout.write(self.style.SUCCESS(f'{reminded} reminder(s) sent.'))
