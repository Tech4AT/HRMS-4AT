"""Fix schema gap: the employees tables in the DB were created from the ZIP's older
migrations which had a simpler model structure. This migration creates missing tables
and adds missing columns using IF NOT EXISTS guards so it is idempotent.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0005_employee_first_name_employee_joining_date_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- ─── Missing tables from employees.0001_initial (current codebase) ───────────

CREATE TABLE IF NOT EXISTS employees_legalentity (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees_location (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ─── Missing tables from employees.0004_org_structure_and_lifecycle ───────────

CREATE TABLE IF NOT EXISTS employees_businessunit (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees_costcenter (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code VARCHAR(30) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ─── Missing columns on employees_employee ────────────────────────────────────

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='legal_entity_id') THEN
        ALTER TABLE employees_employee ADD COLUMN legal_entity_id BIGINT REFERENCES employees_legalentity(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='location_id') THEN
        ALTER TABLE employees_employee ADD COLUMN location_id BIGINT REFERENCES employees_location(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='business_unit_id') THEN
        ALTER TABLE employees_employee ADD COLUMN business_unit_id BIGINT REFERENCES employees_businessunit(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='cost_center_id') THEN
        ALTER TABLE employees_employee ADD COLUMN cost_center_id BIGINT REFERENCES employees_costcenter(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='date_of_exit') THEN
        ALTER TABLE employees_employee ADD COLUMN date_of_exit DATE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='date_of_joining') THEN
        ALTER TABLE employees_employee ADD COLUMN date_of_joining DATE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='dob') THEN
        ALTER TABLE employees_employee ADD COLUMN dob DATE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='employment_type') THEN
        ALTER TABLE employees_employee ADD COLUMN employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='exit_reason') THEN
        ALTER TABLE employees_employee ADD COLUMN exit_reason VARCHAR(200) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='gender') THEN
        ALTER TABLE employees_employee ADD COLUMN gender VARCHAR(20) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='personal_email') THEN
        ALTER TABLE employees_employee ADD COLUMN personal_email VARCHAR(254) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='phone') THEN
        ALTER TABLE employees_employee ADD COLUMN phone VARCHAR(30) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='first_name') THEN
        ALTER TABLE employees_employee ADD COLUMN first_name VARCHAR(150) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='last_name') THEN
        ALTER TABLE employees_employee ADD COLUMN last_name VARCHAR(150) NOT NULL DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='joining_date') THEN
        ALTER TABLE employees_employee ADD COLUMN joining_date DATE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='work_email') THEN
        ALTER TABLE employees_employee ADD COLUMN work_email VARCHAR(254) UNIQUE;
    END IF;
END $$;

-- ─── department.parent FK (from employees.0003_department_parent) ─────────────

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_department' AND column_name='parent_id') THEN
        ALTER TABLE employees_department ADD COLUMN parent_id BIGINT REFERENCES employees_department(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ─── Seed default legal entity so FK is satisfiable ──────────────────────────

INSERT INTO employees_legalentity (name, is_active, created_at, updated_at)
VALUES ('Default Entity', TRUE, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
