# Backfill `code` for existing org masters and prime the CodeSchemes.
# Idempotent and re-runnable: only rows with a blank code are touched, schemes
# are get_or_create'd, and counters only ever move forward (parsed from the
# highest code already in use). Reverse is a no-op — generated codes may be
# referenced or edited since, and unapplying must never blank them.

import re

from django.db import migrations

SCHEMES = {
    # entity_type: (prefix, padding, separator)
    "department": ("DEPT", 3, "-"),
    "job-title": ("JT", 4, "-"),
    "location": ("LOC", 3, "-"),
    "legal-entity": ("LE", 2, "-"),
    "business-unit": ("BU", 3, "-"),
    "cost-center": ("CC", 4, "-"),
    "team": ("TEAM", 3, "-"),
    "job-family": ("JF", 2, "-"),
    "level": ("L", 1, "-"),
    "grade": ("G", 1, "-"),
    "employee": ("EMP", 4, ""),
}

# historical model name per entity_type (post-rename state)
MODELS = {
    "department": "Department",
    "job-title": "JobTitle",
    "location": "Location",
    "legal-entity": "LegalEntity",
    "business-unit": "BusinessUnit",
    "cost-center": "CostCenter",
    "team": "Team",
    "job-family": "JobFamily",
    "level": "Level",
    "grade": "Grade",
}


def _render(prefix, padding, separator, seq):
    return f"{prefix}{separator}{str(seq).zfill(max(padding, 1))}"


def backfill_codes(apps, schema_editor):
    CodeScheme = apps.get_model("employees", "CodeScheme")
    Employee = apps.get_model("employees", "Employee")

    for entity_type, (prefix, padding, separator) in SCHEMES.items():
        scheme, _ = CodeScheme.objects.get_or_create(
            entity_type=entity_type,
            defaults={
                "prefix": prefix,
                "padding": padding,
                "separator": separator,
                "next_seq": 1,
            },
        )
        model_name = MODELS.get(entity_type)
        if model_name is None:
            continue  # employees: codes already assigned by the roster loader
        model = apps.get_model("employees", model_name)
        blanks = list(model.objects.filter(code="").order_by("pk"))
        seq = scheme.next_seq
        pattern = re.compile(
            rf"^{re.escape(prefix)}{re.escape(separator)}(\d+)$"
        )
        used = set()
        for (code,) in model.objects.exclude(code="").values_list("code"):
            m = pattern.match(code)
            if m:
                used.add(int(m.group(1)))
        for row in blanks:
            while seq in used:
                seq += 1
            row.code = _render(prefix, padding, separator, seq)
            row.save(update_fields=["code", "updated_at"])
            used.add(seq)
            seq += 1
        top = max(used) if used else 0
        if scheme.next_seq <= top:
            scheme.next_seq = top + 1
            scheme.save(update_fields=["next_seq", "updated_at"])

    # Prime the employee counter past whatever the roster loader assigned, so
    # next_code("employee") never collides with an existing employee_code.
    scheme = CodeScheme.objects.get(entity_type="employee")
    top = 0
    for (code,) in Employee.objects.values_list("employee_code"):
        m = re.match(r"^EMP(\d+)$", code or "")
        if m:
            top = max(top, int(m.group(1)))
    if not top:
        top = Employee.objects.count()
    if scheme.next_seq <= top:
        scheme.next_seq = top + 1
        scheme.save(update_fields=["next_seq", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0014_codescheme_orgsetting_hierarchyrule"),
    ]

    operations = [
        migrations.RunPython(backfill_codes, reverse_code=migrations.RunPython.noop),
    ]
