"""Seeds Saturday+Sunday as the default org-wide week-off — the behavior that
was previously hardcoded (attendance/day_facts.py used to check
`date.weekday() >= 5` directly) before WeekOff made it HR-admin-configurable.
This migration exists so every environment keeps working the same way it did
before that change, with nothing silently reverting to "no week off at all"
just because the model is now real. HR can reconfigure it afterwards; this
only sets the starting point, get_or_create'd so it's safe to re-run."""

from django.db import migrations

# Sunday-first, matching org_calendar.models.WEEKDAY_NAMES / WeekOff.weekday.
_DEFAULT_WEEK_OFF_WEEKDAYS = [0, 6]  # Sunday, Saturday


def seed_default_week_off(apps, schema_editor):
    WeekOff = apps.get_model("org_calendar", "WeekOff")
    for weekday in _DEFAULT_WEEK_OFF_WEEKDAYS:
        WeekOff.objects.get_or_create(weekday=weekday, defaults={"active": True})


def unseed_default_week_off(apps, schema_editor):
    WeekOff = apps.get_model("org_calendar", "WeekOff")
    WeekOff.objects.filter(weekday__in=_DEFAULT_WEEK_OFF_WEEKDAYS).delete()


class Migration(migrations.Migration):
    dependencies = [("org_calendar", "0002_weekoff")]

    operations = [
        migrations.RunPython(seed_default_week_off, unseed_default_week_off),
    ]
