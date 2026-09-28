from django.core.management.base import BaseCommand
from django.utils import timezone

from employees.exits import complete_exit
from employees.models import Resignation


class Command(BaseCommand):
    help = 'Mark employees EXITED (and disable their login) once their accepted last working day has passed.'

    def handle(self, *args, **options):
        due = Resignation.objects.filter(
            status=Resignation.STATUS_ACCEPTED, last_working_day__lt=timezone.localdate(),
        ).select_related('employee__user')
        count = 0
        for resignation in due:
            complete_exit(resignation)
            count += 1
            self.stdout.write(f'Exited {resignation.employee.full_name} ({resignation.employee.employee_code})')
        self.stdout.write(self.style.SUCCESS(f'{count} exit(s) completed.'))
