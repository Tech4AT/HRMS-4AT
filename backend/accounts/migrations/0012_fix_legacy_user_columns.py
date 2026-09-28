"""Make legacy columns from the ZIP's accounts_user table nullable so current
inserts (which don't include them) can succeed without violating NOT NULL.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0011_fix_rbac_tables"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- failed_login_attempts was a direct column in the ZIP's user model (NOT NULL).
-- The current model tracks this via the separate FailedLoginAttempt model.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_user' AND column_name='failed_login_attempts') THEN
        ALTER TABLE accounts_user ALTER COLUMN failed_login_attempts DROP NOT NULL;
        ALTER TABLE accounts_user ALTER COLUMN failed_login_attempts SET DEFAULT 0;
    END IF;
END $$;

-- Drop any other legacy NOT NULL columns that the current model doesn't set.
-- Inspect all non-nullable columns without a default that our model doesn't know about.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_user' AND column_name='permissions' AND is_nullable='NO') THEN
        ALTER TABLE accounts_user ALTER COLUMN permissions DROP NOT NULL;
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
