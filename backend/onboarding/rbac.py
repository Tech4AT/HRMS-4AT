"""Step 1 of plugging into the core: declare onboarding's permissions and the
default scope each starter role gets. Admins can change these later; re-running
migrate never overwrites their changes (see core/registry.py).

Registered with `enabled=False`: the views are authenticated but do not enforce
these codes yet (see docs/RBAC-WIRING-AUDIT.md), so they stay out of the role
UI until the module enforces them."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="onboarding",
        label="Onboarding",
        enabled=False,
        permissions=(
            PermissionSpec(
                "onboarding.read",
                "View onboarding records, tasks and offer letters within the holder's scope",
                label="View onboarding records",
                group="Onboarding",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "onboarding.write",
                "Create or change onboarding records, tasks and offer letters",
                label="Manage onboarding records",
                group="Onboarding",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
            PermissionSpec(
                "onboarding.manage",
                "Manage onboarding templates and background verification",
                label="Manage onboarding setup",
                group="Onboarding",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
