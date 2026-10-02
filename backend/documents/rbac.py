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
from core.registry import ModuleSpec, PermissionSpec, register_module, register_permissions

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


# ---------------------------------------------------------------------------
# Fine-grained Employee Document Privileges (catalog mirrored from the HR
# reference UI). These cover employee personal-document management and are
# namespaced employee_documents.* so they don't collide with the coarse
# documents.read/write codes above (which cover org/shared documents).
# ---------------------------------------------------------------------------
_EDOC = {"HR Admin": ScopeTier.ALL, "Manager": ScopeTier.MANAGER}
_EDOC_HR = {"HR Admin": ScopeTier.ALL}

register_permissions(
    PermissionSpec("employee_documents.view", "View employees' documents within the holder's scope.",
                   label="View Employee Documents", group="Employee Document Privileges", default_grants=_EDOC),
    PermissionSpec("employee_documents.write", "Add or edit an employee's documents.",
                   label="Add / Edit Employee Documents", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.delete", "Delete an employee's documents.",
                   label="Delete Employee Documents", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.download", "Download an employee's documents.",
                   label="Download Employee Documents", group="Employee Document Privileges", default_grants=_EDOC),
    PermissionSpec("employee_documents.remind", "Send an employee a reminder to submit a required document.",
                   label="Remind Employee To Submit Document", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.verify", "Verify an employee's submitted document.",
                   label="Verify Employee Documents", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.definitions.manage", "Create and manage document definitions (applies organisation-wide).",
                   label="Manage Document Definitions", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.audit.view", "View the audit log of document actions.",
                   label="View Document Audit Logs", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.bulk_upload.manage", "Upload and manage employee documents in bulk.",
                   label="Manage Bulk Upload Documents", group="Employee Document Privileges", default_grants=_EDOC_HR),
    PermissionSpec("employee_documents.bulk_upload.move", "Move bulk-uploaded documents into employee profiles.",
                   label="Move Bulk Uploaded Documents in Profile", group="Employee Document Privileges", default_grants=_EDOC_HR),
)
