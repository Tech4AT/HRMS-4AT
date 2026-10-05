"""Create the payroll roles from PRD §8 (Payroll Admin, Finance Reviewer,
Payroll Approver, Auditor). Their permission grants come from payroll/rbac.py
when a permission is first created. payroll.read/write/manage already exist in
databases migrated before this change, so the registry would never grant them
to these new roles; grant those three here instead, once."""

from django.db import migrations

from core.enums import RoleArchetype, ScopeTier

ROLES = [
    ("Payroll Admin", RoleArchetype.ADMIN),
    ("Finance Reviewer", RoleArchetype.ADMIN),
    ("Payroll Approver", RoleArchetype.ADMIN),
    ("Auditor", RoleArchetype.ADMIN),
]

EXISTING_GRANTS = [
    ("Payroll Admin", "payroll.read"),
    ("Payroll Admin", "payroll.write"),
    ("Payroll Admin", "payroll.manage"),
    ("Finance Reviewer", "payroll.read"),
    ("Payroll Approver", "payroll.read"),
    ("Auditor", "payroll.read"),
]


def create_roles(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")
    for name, archetype in ROLES:
        Role.objects.get_or_create(name=name, defaults={"archetype": archetype})
    for role_name, code in EXISTING_GRANTS:
        permission = Permission.objects.filter(code=code).first()
        if permission is None:
            continue  # fresh database: payroll/rbac.py grants it on creation
        role = Role.objects.get(name=role_name)
        RolePermission.objects.get_or_create(
            role=role, permission=permission, defaults={"scope_tier": ScopeTier.ALL}
        )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_remove_employee_self_write_grant"),
        ("payroll", "0004_prd_payroll_data_model"),
    ]

    operations = [migrations.RunPython(create_roles, migrations.RunPython.noop)]
