# ORG Wave 1 seed: job families, levels, grades and a few positions so the
# frontend has real rows. All get_or_create by name (rerunnable, and a second
# migrate never duplicates). Positions reuse whatever departments,
# designations and employees already exist — on an empty database only the
# reference tables are seeded. Reverse is a no-op on purpose: seed rows may
# have been edited or referenced since, and unapplying must never delete data.

from django.db import migrations

JOB_FAMILIES = [
    "Engineering",
    "Design",
    "Product",
    "Operations",
    "Finance & Accounts",
]

LEVELS = [
    "L1 · Associate",
    "L2 · Engineer",
    "L3 · Senior",
    "L4 · Lead",
    "L5 · Principal",
]

GRADES = ["G1", "G2", "G3", "G4"]


def seed_org_masters(apps, schema_editor):
    JobFamily = apps.get_model("employees", "JobFamily")
    Level = apps.get_model("employees", "Level")
    Grade = apps.get_model("employees", "Grade")
    Department = apps.get_model("employees", "Department")
    Designation = apps.get_model("employees", "Designation")
    Employee = apps.get_model("employees", "Employee")
    Position = apps.get_model("employees", "Position")

    for name in JOB_FAMILIES:
        JobFamily.objects.get_or_create(name=name)
    levels = [Level.objects.get_or_create(name=name)[0] for name in LEVELS]
    grades = [Grade.objects.get_or_create(name=name)[0] for name in GRADES]

    departments = list(Department.objects.filter(is_active=True).order_by("name")[:3])
    designations = list(Designation.objects.filter(is_active=True).order_by("name")[:2])
    incumbents = list(Employee.objects.order_by("id")[: len(departments) * len(designations)])
    if not departments or not designations:
        return

    seat = 0
    for department in departments:
        for designation in designations:
            name = f"{department.name} — {designation.name}"
            position, created = Position.objects.get_or_create(
                name=name,
                defaults={
                    "department_id": department.pk,
                    "job_title_id": designation.pk,
                    "level_id": levels[seat % len(levels)].pk,
                    "grade_id": grades[seat % len(grades)].pk,
                    # Literals, not Position.STATUS_*: frozen historical models
                    # carry fields only, not the model's class constants.
                    "status": "vacant",
                },
            )
            if seat < len(incumbents):
                incumbent = incumbents[seat]
                updated = False
                if position.incumbent_id != incumbent.pk:
                    position.incumbent_id = incumbent.pk
                    updated = True
                if position.status == "vacant":
                    position.status = "filled"
                    updated = True
                if updated:
                    position.save(update_fields=["incumbent", "status", "updated_at"])
                # Mirror the seat onto the holder where the holder has none.
                if incumbent.position_id is None:
                    incumbent.position_id = position.pk
                    level_id = position.level_id
                    grade_id = position.grade_id
                    if incumbent.level_id is None and level_id is not None:
                        incumbent.level_id = level_id
                    if incumbent.grade_id is None and grade_id is not None:
                        incumbent.grade_id = grade_id
                    incumbent.save(update_fields=["position", "level", "grade", "updated_at"])
            seat += 1


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0010_grade_jobfamily_level_employee_grade_employee_level_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_org_masters, reverse_code=migrations.RunPython.noop),
    ]
