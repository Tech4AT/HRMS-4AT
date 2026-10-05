"""Create RBAC tables that the ZIP's old accounts.0001 never created.

The current codebase's accounts.0001_initial defines Permission, Role,
RolePermission and UserPermissionOverride. The ZIP had a simpler accounts app
without those models, so they don't exist in the DB. This migration creates
them using IF NOT EXISTS so it is safe to run multiple times.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0010_fix_missing_columns"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- accounts_permission: create if missing
CREATE TABLE IF NOT EXISTS accounts_permission (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(150) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL DEFAULT ''
);

-- accounts_role: may already exist from ZIP; add missing columns
CREATE TABLE IF NOT EXISTS accounts_role (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='archetype') THEN
        ALTER TABLE accounts_role ADD COLUMN archetype VARCHAR(20) NOT NULL DEFAULT 'employee';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='description') THEN
        ALTER TABLE accounts_role ADD COLUMN description VARCHAR(255) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='is_active') THEN
        ALTER TABLE accounts_role ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='created_at') THEN
        ALTER TABLE accounts_role ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='updated_at') THEN
        ALTER TABLE accounts_role ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounts_rolepermission (
    id BIGSERIAL PRIMARY KEY,
    scope_tier VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    permission_id BIGINT NOT NULL REFERENCES accounts_permission(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES accounts_role(id) ON DELETE CASCADE,
    CONSTRAINT unique_role_permission UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS accounts_userpermissionoverride (
    id BIGSERIAL PRIMARY KEY,
    scope_tier VARCHAR(20) NOT NULL,
    is_granted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by_id BIGINT REFERENCES accounts_user(id) ON DELETE SET NULL,
    permission_id BIGINT NOT NULL REFERENCES accounts_permission(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES accounts_user(id) ON DELETE CASCADE,
    CONSTRAINT unique_user_permission_override UNIQUE (user_id, permission_id)
);

-- Add role FK to accounts_user if missing (from accounts.0001_initial)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='accounts_user' AND column_name='role_id'
    ) THEN
        ALTER TABLE accounts_user ADD COLUMN role_id BIGINT REFERENCES accounts_role(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- If the ZIP left a legacy NOT NULL permissions column, make it nullable so our inserts work
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_role' AND column_name='permissions') THEN
        ALTER TABLE accounts_role ALTER COLUMN permissions DROP NOT NULL;
    END IF;
END $$;

-- Seed the 4 starter roles (mirrors accounts.0002_seed_starter_roles)
INSERT INTO accounts_role (name, archetype, description, is_active, created_at, updated_at)
VALUES
    ('HR Admin',  'superadmin', 'Full HR administration access', TRUE, NOW(), NOW()),
    ('Finance',   'admin',      'Finance and payroll access',   TRUE, NOW(), NOW()),
    ('Manager',   'employee',   'Team manager access',          TRUE, NOW(), NOW()),
    ('Employee',  'employee',   'Standard employee access',     TRUE, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
