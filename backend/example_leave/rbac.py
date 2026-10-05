"""Step 1 of plugging in: declare the permissions this module owns, with the
default scope each starter role gets. Admins can change any of it later, and a
re-run of `migrate` never overwrites their changes (see core/registry.py).

Reference module only — not a production backend. Registered with
`enabled=False` so its permissions stay out of the role UI until a real leave
backend exists."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="example_leave",
        label="Leaves & attendance",
        enabled=False,
        permissions=(
            PermissionSpec(
                "example_leave.read",
                "View leave requests within the holder's scope",
                label="View leave requests",
                group="Leaves & attendance",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "example_leave.write",
                "Submit leave requests",
                label="Submit leave requests",
                group="Leaves & attendance",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.SELF,
                    "HR Admin": ScopeTier.SELF,
                },
            ),
            PermissionSpec(
                "example_leave.approve",
                "Approve leave requests within the holder's scope",
                label="Approve leave requests",
                group="Leaves & attendance",
                default_grants={"Manager": ScopeTier.MANAGER, "HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
