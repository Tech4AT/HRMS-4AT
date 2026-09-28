"""Fix schema gap: the accounts_user table in the DB was created from an
older email-only migration. This migration adds the AbstractUser columns that
are missing and creates the tables that migrations 0004 and 0008 would have
created, so that 0002-0009 can be safely faked and this migration applied.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0009_alter_user_managers"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- Add AbstractUser columns missing from the old email-only table
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='accounts_user' AND column_name='username'
    ) THEN
        ALTER TABLE accounts_user ADD COLUMN username VARCHAR(150) NOT NULL DEFAULT '';
        -- Set username = email first; append id suffix if email is duplicate or blank
        UPDATE accounts_user SET username = email WHERE email IS NOT NULL AND email != '';
        UPDATE accounts_user SET username = 'user_' || id::text
            WHERE username = '' OR username IS NULL;
        -- For any remaining duplicates, append id to make unique
        UPDATE accounts_user u SET username = username || '_' || u.id::text
            WHERE EXISTS (
                SELECT 1 FROM accounts_user u2
                WHERE u2.username = u.username AND u2.id != u.id
            );
        CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_username_key ON accounts_user(username);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='accounts_user' AND column_name='first_name'
    ) THEN
        ALTER TABLE accounts_user ADD COLUMN first_name VARCHAR(150) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='accounts_user' AND column_name='last_name'
    ) THEN
        ALTER TABLE accounts_user ADD COLUMN last_name VARCHAR(150) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='accounts_user' AND column_name='must_change_password'
    ) THEN
        ALTER TABLE accounts_user ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- M2M tables for AbstractUser groups/permissions (may already exist from old migration)
CREATE TABLE IF NOT EXISTS accounts_user_groups (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES accounts_user(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES auth_group(id) ON DELETE CASCADE,
    CONSTRAINT accounts_user_groups_user_id_group_id_key UNIQUE (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS accounts_user_user_permissions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES accounts_user(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES auth_permission(id) ON DELETE CASCADE,
    CONSTRAINT accounts_user_user_permissions_user_id_permission_id_key UNIQUE (user_id, permission_id)
);

-- FailedLoginAttempt table (created by accounts.0004)
CREATE TABLE IF NOT EXISTS accounts_failedloginattempt (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    user_id BIGINT NOT NULL REFERENCES accounts_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS accounts_fa_user_id_92c7c7_idx ON accounts_failedloginattempt(user_id, created_at);

-- PasswordSetupToken table (created by accounts.0008)
CREATE TABLE IF NOT EXISTS accounts_passwordsetuptoken (
    id BIGSERIAL PRIMARY KEY,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    user_id BIGINT NOT NULL REFERENCES accounts_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS accounts_passwordsetuptoken_token_hash_idx ON accounts_passwordsetuptoken(token_hash);
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
