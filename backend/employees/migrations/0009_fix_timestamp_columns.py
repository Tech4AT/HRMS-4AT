"""Add created_at/updated_at to org tables that the ZIP created without them."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0008_fix_nullable_constraints"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_department' AND column_name='created_at') THEN
        ALTER TABLE employees_department ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_department' AND column_name='updated_at') THEN
        ALTER TABLE employees_department ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_department' AND column_name='is_active') THEN
        ALTER TABLE employees_department ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_designation' AND column_name='created_at') THEN
        ALTER TABLE employees_designation ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_designation' AND column_name='updated_at') THEN
        ALTER TABLE employees_designation ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_designation' AND column_name='is_active') THEN
        ALTER TABLE employees_designation ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
