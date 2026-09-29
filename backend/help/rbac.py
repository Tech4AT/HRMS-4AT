"""Permissions this module owns. `help.manage` is what replaces ESSL's single
hardcoded technician account - grantable to any role (or overridden per user)
through the existing Access control UI, at whatever scope tier fits (a
department-scoped support lead, or ALL for a central help desk)."""

from core.enums import ScopeTier
from core.registry import PermissionSpec, register_permissions

register_permissions(
    PermissionSpec(
        "help.read",
        "View own help tickets",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.SELF,
            "HR Admin": ScopeTier.SELF,
            "Finance": ScopeTier.SELF,
        },
    ),
    PermissionSpec(
        "help.write",
        "Create, edit and reopen own help tickets",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.SELF,
            "HR Admin": ScopeTier.SELF,
            "Finance": ScopeTier.SELF,
        },
    ),
    PermissionSpec(
        "help.manage",
        "Triage help tickets: view all, change status, assign",
        default_grants={"HR Admin": ScopeTier.ALL},
    ),
)
