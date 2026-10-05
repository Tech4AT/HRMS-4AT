"""State-only: realign Django's model state for Document.id back to UUID.

Migration 0007_document_pk_bigint was itself state-only and declared the pk as
BigAutoField on the premise that the column was bigint — but in this database
the column is (and has always been) uuid, matching the model's
`UUIDField(primary_key=True)`. That left model state (uuid) out of step with
migration state (bigint), so `makemigrations --check` reported a missing
migration. This corrects the state with no database operation (the column is
already uuid), the same SeparateDatabaseAndState shape 0007 used.
"""

import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0011_merge_20260930_1509"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name="document",
                    name="id",
                    field=models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                )
            ],
            database_operations=[],
        )
    ]
