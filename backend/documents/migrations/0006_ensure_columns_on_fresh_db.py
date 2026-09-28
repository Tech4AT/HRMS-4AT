"""Make the Document columns that earlier state-only migrations only declared in
Django state actually exist on a fresh database. 0004/0005 were written for a
ZIP-imported DB where these columns pre-existed, so they carried no database
operations — which means a brand-new build (tests, a fresh deployment) never
created them and then errors at query time (e.g. `column expiry_date does not
exist`). This adds them with `IF NOT EXISTS`, so it creates them on a fresh DB
and is a harmless no-op on the existing one that already has them. State is left
untouched (0005 already declared the field).
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0005_add_expiry_date"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "ALTER TABLE documents_document "
                "ADD COLUMN IF NOT EXISTS expiry_date date NULL;"
            ),
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
