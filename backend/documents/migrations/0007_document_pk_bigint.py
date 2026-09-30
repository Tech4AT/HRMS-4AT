"""State-only migration: the Document primary key column (and the FK columns
pointing at it) are bigint in this database, so declare BigAutoField. Fixes
`operator does not exist: bigint = uuid` on joins (e.g. onboarding records
list). No database change.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0006_ensure_columns_on_fresh_db"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name="document",
                    name="id",
                    field=models.BigAutoField(primary_key=True, serialize=False),
                )
            ],
            database_operations=[],
        )
    ]
