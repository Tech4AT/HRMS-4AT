"""This module's permissions.

`leave.read`/`leave.write` are not hardcoded anywhere in the frontend
(PLAN.md §6.2 — `leave/page.tsx` never calls `hasPermission`), so their naming
follows `example_leave`'s `<module>.read`/`<module>.write` convention, same as
`attendance.read`/`attendance.write`.

`leave.approve` **is** already a hardcoded frontend string (the Approvals nav
gate for the Leave tab). As with `attendance.approve`, the approvals engine's
own decide endpoints don't consult it — deciding only requires being the named
approver. Here it scopes the read-only `/leave/approvals/pending` list (used
by the Dashboard's pending-count tile) to a manager's reports.

`attendance.settings.manage` is **registered here, not deferred to Step 6**.
It's already a hardcoded frontend string gating three areas across two future
apps (Leave Settings — this module; Shifts and Policy Settings — PLAN.md Step
6, not yet built). Per the registry rule (core/registry.py: one owning
registration; a later app referencing the same code in its own views'
`required_permission` without re-registering it is fine, re-registering an
*identical* spec is a harmless no-op, a *conflicting* one raises), Leave gets
here first and becomes the owner — Step 6 references this code, it does not
redeclare it. PLAN.md §10.3 records this."""

from core.enums import ScopeTier
from core.registry import PermissionSpec, register_permissions

register_permissions(
    PermissionSpec(
        "leave.read",
        "View leave types, own balance, and leave requests within the holder's scope",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.MANAGER,
            "HR Admin": ScopeTier.ALL,
        },
    ),
    PermissionSpec(
        "leave.write",
        "Submit leave requests",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.SELF,
            "HR Admin": ScopeTier.SELF,
        },
    ),
    PermissionSpec(
        "leave.approve",
        "See leave requests awaiting decision within the holder's scope",
        default_grants={"Manager": ScopeTier.MANAGER, "HR Admin": ScopeTier.ALL},
    ),
    PermissionSpec(
        "attendance.settings.manage",
        "Manage Leave Types, Shifts, and Policy Settings",
        default_grants={"HR Admin": ScopeTier.ALL},
    ),
)
