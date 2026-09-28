"""Step 1 of plugging into the core: declare payroll's permissions and the
default scope each starter role gets. Admins can change these later; re-running
migrate never overwrites their changes (see core/registry.py)."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="payroll",
        label="Payroll",
        enabled=True,
        permissions=(
            PermissionSpec(
                "payroll.read",
                "View payroll records within the holder's scope",
                label="View payroll records",
                group="Payroll",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                    "Finance": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "payroll.write",
                "Create or change an employee's payroll records",
                label="Edit payroll records",
                group="Payroll",
                default_grants={"HR Admin": ScopeTier.ALL, "Finance": ScopeTier.ALL},
            ),
            PermissionSpec(
                "payroll.manage",
                "Manage payroll configuration (schedules, components, structures, entities)",
                label="Manage payroll setup",
                group="Payroll",
                default_grants={"HR Admin": ScopeTier.ALL, "Finance": ScopeTier.ALL},
            ),
        ),
    )
)
