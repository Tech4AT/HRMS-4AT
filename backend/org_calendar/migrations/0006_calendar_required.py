import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("org_calendar", "0005_move_existing_data_into_a_calendar")]

    operations = [
        migrations.AlterField(
            model_name="calendarentry",
            name="calendar",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="entries", to="org_calendar.calendar"),
        ),
        migrations.AlterField(
            model_name="recurringwfhrule",
            name="calendar",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="recurring_wfh_rules", to="org_calendar.calendar"),
        ),
        migrations.AlterField(
            model_name="weekoff",
            name="calendar",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="week_offs", to="org_calendar.calendar"),
        ),
        migrations.RemoveField(model_name="weekoff", name="active"),
        migrations.AddConstraint(
            model_name="weekoff",
            constraint=models.UniqueConstraint(fields=("calendar", "weekday"), name="uniq_weekoff_per_day"),
        ),
    ]
