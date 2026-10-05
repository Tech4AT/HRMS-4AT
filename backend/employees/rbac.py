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
                    # TEAM (whole subtree), not MANAGER (direct reports only), so a
                    # manager can see their indirect reports in the editable
                    # directory to reassign reporting lines within their team.
                    "Manager": ScopeTier.TEAM,
                    "HR Admin": ScopeTier.ALL,
                    "Finance": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "employees.write",
                "Create and change employee directory records within the holder's scope",
                label="Create and edit employee records",
                group="Employee data",
                # HR Admin only. A Manager does NOT get this: it would let them
                # change any field of their reports (department, status, which
                # ends someone's access, legal name, ...). What a Manager may do
                # is change reporting lines, via employees.reporting_line.write.
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "employees.reporting_line.write",
                "Change who an employee reports to (and nothing else about them) "
                "within the holder's scope",
                label="Change reporting lines",
                group="Employee data",
                # HR Admin anywhere; a Manager within their own team (TEAM, the whole
                # subtree). The write path requires both the person being moved and
                # the chosen manager to fall inside this scope, so cross-team moves
                # 403, and a request that changes any other field needs
                # employees.write instead.
                default_grants={"HR Admin": ScopeTier.ALL, "Manager": ScopeTier.TEAM},
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
                "org.read",
                "View organisation analytics and the employee activity feed "
                "(aggregate headcounts and per-employee activity rows — no "
                "personal details beyond what the company directory already "
                "shows everyone)",
                label="View organisation analytics",
                group="Organisation",
                default_grants={
                    "Employee": ScopeTier.ALL,
                    "Manager": ScopeTier.ALL,
                    "HR Admin": ScopeTier.ALL,
                    "Finance": ScopeTier.ALL,
                },
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
