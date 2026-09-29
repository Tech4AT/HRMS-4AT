"""PLAN.md Step 7 — the shared scheduled-job mechanism this step (and Steps 3/8
after it) needs "something to run outside a single HTTP request." No task
queue (Celery or otherwise) exists anywhere in this repo (`docker-compose.yml`/
`requirements.txt` confirmed clean) and introducing one for what is, today, a
once-a-year job would be a disproportionate new dependency to add unilaterally.
A plain management command — invoked by an external scheduler (OS cron /
Windows Task Scheduler), the same way any ops team already runs Django
management commands — is the lower-friction choice and the one this codebase
already leans on elsewhere (`verify_rbac`, `seed_demo_org`, ...).

Idempotent by construction: `get_or_seed_balance()` only ever creates a given
employee/type/year row once, so running this twice for the same year (or
every day for a week, if the scheduler is generous) never double-seeds or
double-credits carry-forward."""

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.enums import EmployeeStatus
from employees.models import Employee
from leave.balances import get_or_seed_balance
from leave.models import LeaveType, LeaveTypeStatus


class Command(BaseCommand):
    help = (
        "Seed each active employee's opening balance + carry-forward for a "
        "financial year, for every active leave type. Idempotent — safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--year",
            type=int,
            default=None,
            help="Financial year to seed (plain calendar year). Defaults to the current year.",
        )

    def handle(self, *args, **options):
        financial_year = str(options["year"] or timezone.localdate().year)
        leave_types = list(LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE))
        employees = list(Employee.objects.filter(status=EmployeeStatus.ACTIVE))

        seeded = 0
        for employee in employees:
            for leave_type in leave_types:
                _balance, created = get_or_seed_balance(employee, leave_type, financial_year)
                seeded += int(created)

        summary = (
            f"Financial year {financial_year}: seeded {seeded} new balance row(s) "
            f"({len(employees)} employee(s) x {len(leave_types)} leave type(s))."
        )
        self.stdout.write(self.style.SUCCESS(summary))
