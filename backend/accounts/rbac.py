from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="accounts",
        label="Access control",
        enabled=True,
        permissions=(
            PermissionSpec(
                "roles.manage",
                "Administer roles, permission grants, per-person overrides and user accounts",
                label="Manage roles and access",
                group="Access control",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
