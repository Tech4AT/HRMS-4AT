from django.db import migrations


class Migration(migrations.Migration):
    """Merge two divergent leaves in the documents migration graph: the
    org-documents line (0010_documentaudiencerole) and the pk-bigint line
    (0007_document_pk_bigint), which a branch merge left unjoined. No schema
    change — a graph join only."""

    dependencies = [
        ("documents", "0010_documentaudiencerole"),
        ("documents", "0007_document_pk_bigint"),
    ]

    operations = []
