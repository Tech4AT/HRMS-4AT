"""Add columns missing from the ZIP's audit_auditlog table."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_auditlog' AND column_name='diff') THEN
        ALTER TABLE audit_auditlog ADD COLUMN diff JSONB NOT NULL DEFAULT '{}';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_auditlog' AND column_name='entity_id') THEN
        ALTER TABLE audit_auditlog ADD COLUMN entity_id VARCHAR(50) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_auditlog' AND column_name='entity_type') THEN
        ALTER TABLE audit_auditlog ADD COLUMN entity_type VARCHAR(100) NOT NULL DEFAULT '';
    END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS audit_audit_entity__9535bf_idx ON audit_auditlog(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_audit_action_86e815_idx ON audit_auditlog(action);
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
