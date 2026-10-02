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
from core.registry import ModuleSpec, PermissionSpec, register_module, register_permissions

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


# ---------------------------------------------------------------------------
# Fine-grained Asset Privileges (catalog mirrored from the HR reference UI).
# These sit alongside the coarse assets.read/write/manage codes above and give
# the role builder a granular "Asset Privileges" group. default_grants target
# HR Admin and it_admin (IT staff provision equipment); applied only on first
# creation, so admin edits are never overwritten.
# ---------------------------------------------------------------------------
_HRIT = {"HR Admin": ScopeTier.ALL, "it_admin": ScopeTier.ALL}

register_permissions(
    PermissionSpec("assets.dashboard.view", "View the asset management dashboard and its summary KPIs.",
                   label="View Asset Dashboard", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.inventory.view", "Browse the full asset inventory list.",
                   label="View Asset Inventory", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.add", "Create a single new asset record.",
                   label="Add Individual Asset", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.edit", "Edit the details of an existing asset.",
                   label="Edit Individual Asset Information", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.bulk_import", "Import assets and their assignments in bulk from a file.",
                   label="Bulk import assets & assignment", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.assign", "Allot an asset to an employee.",
                   label="Assign Asset to an Employee", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.availability.update", "Change an asset's availability status.",
                   label="Update Asset Availability", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.recover", "Recover an asset from an employee and record its condition.",
                   label="Recover Asset & Update Condition", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.reports.view", "View asset reports.",
                   label="View Reports", group="Asset Privileges", default_grants=_HRIT),
    PermissionSpec("assets.reports.download", "Download asset reports (e.g. CSV export).",
                   label="Download Reports", group="Asset Privileges", default_grants=_HRIT),
)
