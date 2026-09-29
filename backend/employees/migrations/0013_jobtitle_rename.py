# Designation -> JobTitle rename. ALIASED (RenameModel), not drop+recreate:
# the table employees_designation becomes employees_jobtitle with every row
# kept, and the Employee.designation / Position.job_title columns keep their
# names — only the model class (and its content-type/permission labels) change.
# The new job_family/level/is_people_manager columns are nullable/defaulted.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0012_businessunit_code_businessunit_description_and_more"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="Designation",
            new_name="JobTitle",
        ),
        migrations.AddField(
            model_name="jobtitle",
            name="job_family",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="job_titles",
                to="employees.jobfamily",
            ),
        ),
        migrations.AddField(
            model_name="jobtitle",
            name="level",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="job_titles",
                to="employees.level",
            ),
        ),
        migrations.AddField(
            model_name="jobtitle",
            name="is_people_manager",
            field=models.BooleanField(default=False),
        ),
    ]
