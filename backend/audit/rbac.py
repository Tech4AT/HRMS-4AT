from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="audit",
        label="Audit & activity",
        enabled=True,
        permissions=(
            PermissionSpec(
                "audit.read",
                "View the activity log (who did what, and when)",
                label="View activity log",
                group="Audit & activity",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
