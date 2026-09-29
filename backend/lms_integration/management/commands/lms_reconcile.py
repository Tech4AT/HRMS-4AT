"""Scheduled identity reconciliation (Data Mapping §4).

    python manage.py lms_reconcile              # report only
    python manage.py lms_reconcile --provision  # also queue the safe fixes
"""

from django.core.management.base import BaseCommand

from lms_integration.reconcile import reconcile


class Command(BaseCommand):
    help = "Compare HRMS employees with LMS learners and record the mismatches."

    def add_arguments(self, parser):
        parser.add_argument("--provision", action="store_true")

    def handle(self, *args, provision, **options):
        run = reconcile(provision=provision, trigger="scheduled")
        self.stdout.write(f"Run {run.pk}: {run.status} {run.summary or run.error}")
