"""Broadcast a company announcement: an in-app notification to every active user
(so it shows in each person's bell) and, optionally, an email to one address.

    manage.py send_announcement --title "..." --body "..." [--email a@b.com]
                                [--recipients all|admins]

Built on the notifications primitive (notify + send_email). Email delivery
depends on EMAIL_BACKEND — the console backend just logs it; set SMTP env vars
for real delivery."""

from django.core.management.base import BaseCommand

from notifications.service import broadcast, send_email


class Command(BaseCommand):
    help = "Send an in-app announcement to users, and optionally email an address."

    def add_arguments(self, parser):
        parser.add_argument("--title", required=True)
        parser.add_argument("--body", required=True)
        parser.add_argument("--email", help="Also send the announcement to this email address.")
        parser.add_argument(
            "--recipients",
            choices=["all", "admins"],
            default="all",
            help="Who gets the in-app notification (default: all active users).",
        )

    def handle(self, *args, **options):
        count = broadcast(options["title"], options["body"], options["recipients"])
        self.stdout.write(self.style.SUCCESS(f"Created {count} in-app notifications."))

        if options["email"]:
            ok = send_email(options["email"], options["title"], options["body"])
            status = "sent" if ok else "not sent (check EMAIL_BACKEND / server log)"
            self.stdout.write(f"Email to {options['email']}: {status}")
