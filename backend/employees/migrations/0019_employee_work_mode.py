from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0018_employee_teams"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="work_mode",
            field=models.CharField(
                choices=[("office", "Office"), ("remote", "Remote"), ("hybrid", "Hybrid")],
                default="office",
                max_length=20,
            ),
        ),
    ]
