"""This module's permissions. `attendance.read`/`attendance.write` are not
hardcoded anywhere in the frontend (PLAN.md Step 3/10.1 — the frontend never
calls hasPermission on My Attendance) so their naming follows the only existing
precedent, example_leave's `<module>.read`/`<module>.write` convention.

`attendance.approve` **is** already a hardcoded frontend string (the Approvals
nav gate). Per PLAN.md Step 3, the approvals engine's own approve/reject
endpoints don't consult it — deciding a request only requires being its named
approver, which the engine resolves itself. Here it plays a narrower, still-real
role: it scopes the read-only "requests awaiting my decision" list
(`/attendance/requests/approvals/pending`, used by the Dashboard's pending-count
tile) to a manager's reports, via the same resolve_employee_scope() every other
scoped permission uses. It is not a write permission and is not in this view's
action_permissions for any mutation.

`penalisation.manage` (PLAN.md Step 8) is new — the Approvals → Penalisation
tab has no existing hardcoded frontend permission string (1.6 flagged this as
a gap). Flat, `HasPermissionCode` (not scoped), `<module>.manage` naming
matching `attendance.settings.manage`'s own admin-only convention, since the
corrected design (§1.3) has no review/decide split — just one HR action,
overturn — not a `.review`/`.approve` verb that would imply deciding someone
else's routed request."""

from core.enums import ScopeTier
from core.registry import PermissionSpec, register_permissions

register_permissions(
    PermissionSpec(
        "attendance.read",
        "View attendance records and requests within the holder's scope",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.MANAGER,
            "HR Admin": ScopeTier.ALL,
        },
    ),
    PermissionSpec(
        "attendance.write",
        "Check in/out, manage breaks, and submit WFH/regularisation requests",
        default_grants={
            "Employee": ScopeTier.SELF,
            "Manager": ScopeTier.SELF,
            "HR Admin": ScopeTier.SELF,
        },
    ),
    PermissionSpec(
        "attendance.approve",
        "See WFH/regularisation requests awaiting decision within the holder's scope",
        default_grants={"Manager": ScopeTier.MANAGER, "HR Admin": ScopeTier.ALL},
    ),
    PermissionSpec(
        "penalisation.manage",
        "View every employee's Penalisations and overturn one directly",
        default_grants={"HR Admin": ScopeTier.ALL},
    ),
)
