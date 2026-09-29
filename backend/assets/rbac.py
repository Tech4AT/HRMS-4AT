"""Step 1 of plugging into the core: declare the assets module's permissions
and the default scope each starter role gets. `<app>/rbac.py` is imported
automatically at startup (core.apps.CoreConfig.ready) and synced to the DB
after every `migrate` — see core/registry.py.

Three codes:

- `assets.read` — view assets within the holder's scope. Every employee
  holds this at SELF (their own assigned laptop, via the employee baseline);
  HR Admin and IT Admin hold ALL (the whole inventory).
- `assets.write` — assign / update assets. HR Admin and IT Admin hold ALL.
- `assets.manage` — full administration. HR Admin holds ALL.

"IT department" maps to the IT Admin role (its charter is IT staff
provisioning equipment) — the scope engine is role-based, so a department
grant cannot cover the whole inventory; see seed_it_admin_role, which also
grants this role its assets codes directly so ordering with migrate never
drops them.
"""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="assets",
        label="Assets",
        enabled=True,
        permissions=(
            PermissionSpec(
                "assets.read",
                "View assets within the holder's scope",
                label="View assets",
                group="Assets",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.SELF,
                    "HR Admin": ScopeTier.ALL,
                    "it_admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "assets.write",
                "Assign and update assets",
                label="Manage asset assignments",
                group="Assets",
                default_grants={
                    "HR Admin": ScopeTier.ALL,
                    "it_admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "assets.manage",
                "Full administration of the asset inventory",
                label="Administer assets",
                group="Assets",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
