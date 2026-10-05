"""Add columns that exist in the current model but were absent from the ZIP's documents_document table."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0002_document_employee_document_original_filename_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
-- original_name: mirrors original_filename; back-fill from that column
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='documents_document' AND column_name='original_name') THEN
        ALTER TABLE documents_document ADD COLUMN original_name VARCHAR(255) NOT NULL DEFAULT '';
        UPDATE documents_document SET original_name = original_filename WHERE original_name = '';
    END IF;
END $$;

-- content_type: optional, blank by default
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='documents_document' AND column_name='content_type') THEN
        ALTER TABLE documents_document ADD COLUMN content_type VARCHAR(127) NOT NULL DEFAULT '';
    END IF;
END $$;

-- size: file size in bytes, defaults to 0
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='documents_document' AND column_name='size') THEN
        ALTER TABLE documents_document ADD COLUMN size BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
