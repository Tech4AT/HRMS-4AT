"""Step 1 of plugging into the core: declare this module's permission(s) and
the default scope each starter role gets. Admins can change this later;
re-running migrate never overwrites their change (see core/registry.py).

calendar.manage is already a hardcoded permission string in the frontend
(frontend/src/app/(app)/layout.tsx's Settings nav gate,
attendance/settings/page.tsx's Calendar Management tab gate) - this file makes
it a real, enforced permission. It is a flat capability (the calendar isn't
employee-keyed data), so unlike an employee-scoped permission it doesn't need
separate read/write codes: HasPermissionCode uses one code for every action on
purpose (see core/permissions.py)."""

from core.enums import ScopeTier
from core.registry import PermissionSpec, register_permissions

register_permissions(
    PermissionSpec(
        "calendar.manage",
        "Manage the organisation-wide calendar (holidays, WFH days, events, "
        "and the recurring WFH rule)",
        default_grants={"HR Admin": ScopeTier.ALL},
    ),
)
