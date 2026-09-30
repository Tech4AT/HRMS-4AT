"""Step 1 of plugging into the core: declare the document_templates module's
permissions and the default scope each starter role gets. `<app>/rbac.py` is
imported automatically at startup (core.apps.CoreConfig.ready) and synced to
the DB after every `migrate` — see core/registry.py.

Two codes:

- `templates.read` — view templates. Every employee holds this (ALL tier —
  templates are org-wide shells, not per-employee records, so there is no
  narrower scope to filter by).
- `templates.manage` — create / edit / delete / generate. HR Admin holds ALL
  (plus superusers, who bypass via is_hr_admin).
"""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="document_templates",
        label="Document Templates",
        enabled=True,
        permissions=(
            PermissionSpec(
                "templates.read",
                "View document templates",
                label="View templates",
                group="Document Templates",
                default_grants={
                    "Employee": ScopeTier.ALL,
                    "Manager": ScopeTier.ALL,
                    "HR Admin": ScopeTier.ALL,
                    "it_admin": ScopeTier.ALL,
                },
            ),
            PermissionSpec(
                "templates.manage",
                "Create, edit, delete and generate from document templates",
                label="Manage templates",
                group="Document Templates",
                default_grants={"HR Admin": ScopeTier.ALL},
            ),
        ),
    )
)
