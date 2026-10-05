"""State-only migration: keep Django's model state for the Document primary key
in sync with the actual column, which is a UUID (see 0001_initial). An earlier
version of this migration declared BigAutoField to match a different (ZIP-import)
database whose Document PK was bigint; on this database the column is and always
was uuid, so declaring bigint desynced Django's state from reality and made every
foreign key to Document (e.g. onboarding.OfferLetter.document) build as bigint and
collide with the real uuid column. This restores the uuid state. No database
change — the column is already uuid.
"""

import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0003_fix_missing_columns"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name="document",
                    name="id",
                    field=models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                )
            ],
            database_operations=[],  # DB column is already uuid — nothing to change.
        )
    ]
