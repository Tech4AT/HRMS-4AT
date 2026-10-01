"""Narrow the Manager role from "edit employee records" to "change reporting lines".

0015 let managers change the reporting line of their team by granting them
employees.write at TEAM. That permission is far wider than the need: it also
allows editing any field of a report (department, designation, status -
including exiting them, which ends their access - dates, legal name through
Employee 360) and creating employees. The requirement was only to view and
reassign reporting lines within a team.

This takes the over-broad employees.write grant back from Manager and leaves the
widened employees.read (TEAM) that the reporting-line screen needs to list indirect
reports. The new employees.reporting_line.write permission (employees/rbac.py) is
seeded for Manager (TEAM) and HR Admin (ALL) by the registry sync that runs after
every migrate, and EmployeeViewSet accepts it for a request that changes only
`manager_id`.

Only a grant still at the tier 0015 set (TEAM) is removed: a deliberate customisation
by an administrator (a different tier) is left alone.
"""

from django.db import migrations

from core.enums import ScopeTier


def take_back_manager_write(apps, schema_editor):
    RolePermission = apps.get_model("accounts", "RolePermission")
    RolePermission.objects.filter(
        role__name="Manager",
        permission__code="employees.write",
        scope_tier=ScopeTier.TEAM,
    ).delete()


def restore_manager_write(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")

    manager = Role.objects.filter(name="Manager").first()
    if manager is None:
        return
    write, _ = Permission.objects.get_or_create(
        code="employees.write", defaults={"description": "Edit employee records"}
    )
    RolePermission.objects.update_or_create(
        role=manager, permission=write, defaults={"scope_tier": ScopeTier.TEAM}
    )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0015_manager_edit_reporting_lines"),
    ]

    operations = [
        migrations.RunPython(take_back_manager_write, restore_manager_write),
    ]
