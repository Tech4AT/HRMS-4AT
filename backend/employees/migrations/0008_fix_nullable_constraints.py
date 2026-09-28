"""Make ZIP-era NOT NULL constraints nullable where our current models use null=True."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0007_resignation_model"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- employees_employee: make all nullable model fields actually nullable in DB

DO $$ DECLARE col TEXT; BEGIN
    FOREACH col IN ARRAY ARRAY['joining_date','date_of_exit','date_of_joining','dob',
                               'work_email','business_unit_id','cost_center_id',
                               'department_id','designation_id','manager_id',
                               'legal_entity_id','location_id','personal_email',
                               'phone','exit_reason','gender','first_name','last_name'] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'employees_employee'
              AND column_name = col
              AND is_nullable = 'NO'
              -- only drop NOT NULL for fields our model marks as optional
              AND column_name IN (
                  'joining_date','date_of_exit','date_of_joining','dob','work_email',
                  'business_unit_id','cost_center_id','department_id','designation_id',
                  'manager_id','legal_entity_id','location_id'
              )
        ) THEN
            EXECUTE format('ALTER TABLE employees_employee ALTER COLUMN %I DROP NOT NULL', col);
        END IF;
    END LOOP;
END $$;

-- Also ensure string fields that should be blank=True have a default of ''
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='personal_email') THEN
        ALTER TABLE employees_employee ALTER COLUMN personal_email SET DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='phone') THEN
        ALTER TABLE employees_employee ALTER COLUMN phone SET DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='exit_reason') THEN
        ALTER TABLE employees_employee ALTER COLUMN exit_reason SET DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='gender') THEN
        ALTER TABLE employees_employee ALTER COLUMN gender SET DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='first_name') THEN
        ALTER TABLE employees_employee ALTER COLUMN first_name SET DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees_employee' AND column_name='last_name') THEN
        ALTER TABLE employees_employee ALTER COLUMN last_name SET DEFAULT '';
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
