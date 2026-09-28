"""Make legacy NOT NULL columns in audit_auditlog nullable."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0002_fix_missing_columns"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- diff_json was a NOT NULL column in the ZIP's audit model; make it nullable
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_auditlog' AND column_name='diff_json') THEN
        ALTER TABLE audit_auditlog ALTER COLUMN diff_json DROP NOT NULL;
        ALTER TABLE audit_auditlog ALTER COLUMN diff_json SET DEFAULT '{}';
    END IF;
END $$;

-- actor_id may also need a default (null is allowed per current model)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_auditlog' AND column_name='actor_id' AND is_nullable='NO') THEN
        ALTER TABLE audit_auditlog ALTER COLUMN actor_id DROP NOT NULL;
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
