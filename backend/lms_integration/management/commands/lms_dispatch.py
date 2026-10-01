"""Deliver queued HRMS -> LMS events.

    python manage.py lms_dispatch               # one batch (cron, every minute)
    python manage.py lms_dispatch --loop 15     # keep running, a batch every 15s
"""

import time

from django.core.management.base import BaseCommand

from lms_integration.dispatcher import dispatch_due


class Command(BaseCommand):
    help = "Deliver pending/retrying outbound LMS integration events."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument(
            "--loop", type=int, default=0, metavar="SECONDS", help="Repeat every N seconds."
        )

    def handle(self, *args, limit, loop, **options):
        while True:
            counts = dispatch_due(limit=limit)
            if counts.get("claimed") or counts.get("skipped") or not loop:
                self.stdout.write(str(counts))
            if not loop:
                return
            time.sleep(loop)
