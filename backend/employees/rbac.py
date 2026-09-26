from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

# Everyone who can sign in may see and update their own profile.
_EVERYONE_SELF = {
    "Employee": ScopeTier.SELF,
    "Manager": ScopeTier.SELF,
    "HR Admin": ScopeTier.SELF,
    "Finance": ScopeTier.SELF,
    "Executive": ScopeTier.SELF,
}

register_module(
    ModuleSpec(
        key="employees",
        label="Employee data",
        enabled=True,
        permissions=(
            PermissionSpec(
                "employees.read",
                "View employee directory records within the holder's scope",
                label="View employee records",
                group="Employee data",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                    "Finance": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "employees.write",
                "Create and change employee directory records within the holder's scope",
                label="Create and edit employee records",
                group="Employee data",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "employees.personal.read",
                "View employees' personal details (personal email, phone, date of birth, gender)",
                label="View personal details",
                group="Employee data",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "employees.personal.write",
                "Change employees' personal details",
                label="Edit personal details",
                group="Employee data",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "org.manage",
                "Manage the organisation structure: departments, teams, job titles, "
                "job families, levels, grades, positions, locations, "
                "legal entities, business units and cost centres",
                label="Manage organisation structure",
                group="Organisation",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "ess.profile.read",
                "View your own employee profile",
                label="View own profile",
                group="Self-service",
                default_grants=_EVERYONE_SELF,
            ),
            PermissionSpec(
                "ess.profile.write",
                "Update your own contact details, date of birth and gender",
                label="Update own profile",
                group="Self-service",
                default_grants=_EVERYONE_SELF,
            ),
        ),
    )
)
