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


# ---------------------------------------------------------------------------
# Fine-grained Attendance Privileges (catalog mirrored from the HR reference
# UI). These give the role builder a granular "Attendance Privileges" group
# for manager/HR self-service-on-behalf and approvals, alongside the coarse
# attendance.read/write/approve codes above.
# ---------------------------------------------------------------------------
_ATT = {"HR Admin": ScopeTier.ALL, "Manager": ScopeTier.MANAGER}

register_permissions(
    PermissionSpec("attendance.details.view", "View employees' attendance details within the holder's scope.",
                   label="View employees attendance details", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.regularization.apply_on_behalf", "Raise an attendance adjustment / regularization on an employee's behalf.",
                   label="Apply for attendance adjustment / regularization on behalf of employees", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.regularization.approve", "Approve or reject attendance adjustment / regularization requests.",
                   label="Approve/Reject attendance adjustment / regularization requests", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.wfh_od.apply_on_behalf", "Apply Work from Home (WFH) / On Duty (OD) on an employee's behalf.",
                   label="Apply 'Work from Home (WFH) / On Duty (OD)' on behalf of employees", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.wfh_od.approve", "Approve or reject Work from Home (WFH) / On Duty (OD) requests.",
                   label="Approve/Reject 'Work from Home (WFH) / On Duty (OD)' requests", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.wfh_od.cancel", "Cancel a Work from Home (WFH) / On Duty (OD) request.",
                   label="Cancel 'Work from Home (WFH) / On Duty (OD)' requests", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.partial_day.apply_on_behalf", "Apply for a partial day on an employee's behalf.",
                   label="Apply for partial day on behalf of employees", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.partial_day.approve", "Approve or reject partial day requests.",
                   label="Approve/Reject partial day requests", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.partial_day.cancel", "Cancel a partial day request.",
                   label="Cancel partial day request", group="Attendance Privileges", default_grants=_ATT),
    PermissionSpec("attendance.ot.view", "View employees' overtime (OT) requests.",
                   label="View employees' overtime (OT) requests", group="Attendance Privileges", default_grants=_ATT),
)
