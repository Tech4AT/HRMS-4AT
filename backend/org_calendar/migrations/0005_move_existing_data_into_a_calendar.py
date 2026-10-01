"""Moves the previous organisation-wide calendar data into one ordinary
calendar named "General" so nothing already configured is lost.

"General" is a normal calendar - not a default or fallback. It is assigned
explicitly to every existing active department, plus every existing employee who
has no department, so that today's people keep exactly the holidays and weekly
offs they have now. Anyone added later is covered only by calendars HR assigns
them to. Nothing is created on an installation that has no legacy rows."""

from django.db import migrations

LEGACY_NAME = "General"


def move_legacy_rows(apps, schema_editor):
    Calendar = apps.get_model("org_calendar", "Calendar")
    CalendarEntry = apps.get_model("org_calendar", "CalendarEntry")
    RecurringWfhRule = apps.get_model("org_calendar", "RecurringWfhRule")
    WeekOff = apps.get_model("org_calendar", "WeekOff")
    Department = apps.get_model("employees", "Department")
    Employee = apps.get_model("employees", "Employee")

    # Inactive week-off rows meant "working day"; the new model expresses that by
    # having no row at all.
    WeekOff.objects.filter(active=False).delete()

    if not (
        CalendarEntry.objects.exists()
        or RecurringWfhRule.objects.exists()
        or WeekOff.objects.exists()
    ):
        return

    calendar = Calendar.objects.create(
        name=LEGACY_NAME, description="Created from the previous organisation-wide calendar."
    )
    CalendarEntry.objects.filter(calendar__isnull=True).update(calendar=calendar)
    RecurringWfhRule.objects.filter(calendar__isnull=True).update(calendar=calendar)
    WeekOff.objects.filter(calendar__isnull=True).update(calendar=calendar)

    calendar.departments.set(Department.objects.filter(is_active=True))
    calendar.employees.set(Employee.objects.filter(department__isnull=True))


def noop(apps, schema_editor):
    """Reversal keeps the rows; 0006's reversal makes the FK nullable again."""


class Migration(migrations.Migration):
    dependencies = [("org_calendar", "0004_calendar_schema")]

    operations = [migrations.RunPython(move_legacy_rows, noop)]
