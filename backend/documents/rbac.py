"""Step 1 of plugging into the core: declare the documents module's permissions
and the default scope each starter role gets. `<app>/rbac.py` is imported
automatically at startup (core.apps.CoreConfig.ready) and synced to the DB
after every `migrate` — see core/registry.py.

Two codes (docs/ARCHITECTURE.md primitive #6):

- `documents.read` — view document metadata and file bytes. Every employee
  holds this at SELF (their own files); HR Admin holds ALL.
- `documents.write` — upload/delete files. Every employee holds this at SELF
  (upload to their own record / delete their own uploads); HR Admin holds ALL
  (upload on anyone's behalf, delete anything).

The per-entity_type rules (which *other* employees' files a holder may see —
e.g. `employee_document` via `employees.personal.read`) live in
documents/access.py's ENTITY_PERMISSIONS and are enforced per request in the
views, not by these two codes alone: the views grant the owner and HR Admin
directly and consult the entity mapping for everyone else.
"""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

register_module(
    ModuleSpec(
        key="documents",
        label="Documents",
        enabled=True,
        permissions=(
            PermissionSpec(
                "documents.read",
                "View document metadata and files within the holder's scope",
                label="View documents",
                group="Documents",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.SELF,
                    "HR Admin": ScopeTier.ALL,
                    "Finance": ScopeTier.SELF,
                },
            ),
            PermissionSpec(
                "documents.write",
                "Upload documents to your own record and delete your own uploads",
                label="Upload documents",
                group="Documents",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.SELF,
                    "HR Admin": ScopeTier.ALL,
                },
            ),
        ),
    )
)
