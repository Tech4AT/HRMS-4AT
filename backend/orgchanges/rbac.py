"""Step 1 of plugging into the core: declare orgchanges' permissions and the
default scope each starter role gets."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="orgchanges",
        label="Organisation",
        enabled=True,
        permissions=(
            PermissionSpec(
                "orgchanges.read",
                "View organisation changes (promotions, transfers) within the holder's scope",
                label="View organisation changes",
                group="Organisation",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "orgchanges.write",
                "Raise, change and cancel organisation changes within the holder's scope",
                label="Raise organisation changes",
                group="Organisation",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
