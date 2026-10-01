"""Step 1 of making calendars first-class: add `Calendar` and the (still
nullable) `calendar` FKs plus the new columns. 0005 moves the existing org-wide
rows into a calendar; 0006 then makes the FKs required."""

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0020_merge_20260930_1509"),
        ("org_calendar", "0003_seed_default_week_off"),
    ]

    operations = [
        migrations.CreateModel(
            name="Calendar",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("description", models.CharField(blank=True, max_length=300)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("departments", models.ManyToManyField(blank=True, related_name="calendars", to="employees.department")),
                ("employees", models.ManyToManyField(blank=True, related_name="calendars", to="employees.employee")),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.AddField(
            model_name="calendarentry",
            name="calendar",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="entries", to="org_calendar.calendar"),
        ),
        migrations.AddField(model_name="calendarentry", name="optional", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="calendarentry", name="special", field=models.BooleanField(default=False)),
        migrations.AddField(
            model_name="recurringwfhrule",
            name="calendar",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="recurring_wfh_rules", to="org_calendar.calendar"),
        ),
        migrations.AddField(
            model_name="weekoff",
            name="calendar",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="week_offs", to="org_calendar.calendar"),
        ),
        migrations.AddField(
            model_name="weekoff",
            name="weeks",
            field=models.JSONField(blank=True, default=list, help_text="Occurrences in the month that are off (1-5). Empty = every week."),
        ),
        migrations.AlterField(
            model_name="weekoff",
            name="weekday",
            field=models.PositiveSmallIntegerField(
                help_text="0 = Sunday ... 6 = Saturday, matching WEEKDAY_NAMES.",
                validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(6)],
            ),
        ),
    ]
