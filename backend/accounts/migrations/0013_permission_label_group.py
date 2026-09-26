"""Short UI labels for permissions: `label` (the checkbox row text) and `group`
(the feature area it is listed under), synced from each module's `rbac.py`.
Purely additive — existing rows keep their code/description untouched.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0012_fix_legacy_user_columns"),
    ]

    operations = [
        migrations.AddField(
            model_name="permission",
            name="label",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="permission",
            name="group",
            field=models.CharField(blank=True, max_length=120),
        ),
    ]
