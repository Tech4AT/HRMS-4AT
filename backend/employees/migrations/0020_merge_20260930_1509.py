from django.db import migrations


class Migration(migrations.Migration):
    """Merge two divergent leaves in the employees migration graph: the
    work-mode line (0019_employee_work_mode) and the about/skills line
    (0013_employee_about_skills), which a branch merge left unjoined. No
    schema change — a graph join only."""

    dependencies = [
        ("employees", "0019_employee_work_mode"),
        ("employees", "0013_employee_about_skills"),
    ]

    operations = []
