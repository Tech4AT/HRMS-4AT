"""Let the Manager role edit reporting lines within its own team.

Managers previously had only employees.read at MANAGER tier (direct reports)
and no employees.write at all, so they could not reassign anyone's manager.
This grants Manager employees.write at TEAM (whole subtree) and widens its
employees.read to TEAM to match, so a manager sees and edits the reporting
lines of their direct and indirect reports. The existing write path
(EmployeeViewSet + ScopedEmployeePermission) already 403s any target or chosen
manager outside that scope; this migration only opens the tier.

sync_registered_permissions() writes default grants only on first create and
never updates an existing tier, so the read widening must be done here.
"""

from django.db import migrations

from core.enums import ScopeTier


def open_manager_scope(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")

    manager = Role.objects.filter(name="Manager").first()
    if manager is None:
        return  # fresh DB without starter roles; sync will seed from rbac.py

    write, _ = Permission.objects.get_or_create(
        code="employees.write", defaults={"description": "Edit employee records"}
    )
    RolePermission.objects.update_or_create(
        role=manager, permission=write, defaults={"scope_tier": ScopeTier.TEAM}
    )

    read = Permission.objects.filter(code="employees.read").first()
    if read is not None:
        RolePermission.objects.update_or_create(
            role=manager, permission=read, defaults={"scope_tier": ScopeTier.TEAM}
        )


def restore_manager_scope(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")

    manager = Role.objects.filter(name="Manager").first()
    if manager is None:
        return
    RolePermission.objects.filter(
        role=manager, permission__code="employees.write"
    ).delete()
    read = Permission.objects.filter(code="employees.read").first()
    if read is not None:
        RolePermission.objects.filter(role=manager, permission=read).update(
            scope_tier=ScopeTier.MANAGER
        )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0014_user_roles_m2m")]

    operations = [migrations.RunPython(open_manager_scope, restore_manager_scope)]
