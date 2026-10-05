"""State-only migration: add expiry_date to Document model state.
The column already exists in the DB (from the ZIP schema)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0004_fix_pk_type"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="document",
                    name="expiry_date",
                    field=models.DateField(blank=True, null=True),
                )
            ],
            database_operations=[],  # column already exists in DB
        )
    ]
