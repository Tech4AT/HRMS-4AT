"""Shared enums used by both the accounts app (Role/Permission/RolePermission,
UserPermissionOverride) and core.scope's resolver, kept here so accounts doesn't
have to import from employees or vice versa.

See docs/REQUIREMENTS.md §0 for what each scope tier means in product terms.
"""

from django.db import models


class ScopeTier(models.TextChoices):
    """How far out from the caller a permission reaches, narrowest to broadest.
    Every tier except SELF implicitly includes the caller's own record."""

    SELF = "self", "Self"
    MANAGER = "manager", "Reporting Manager"
    TEAM = "team", "Team"
    DEPARTMENT = "department", "Department"
    LOCATION = "location", "Location"
    LEGAL_ENTITY = "legal_entity", "Legal Entity"
    ALL = "all", "All Employees"


class EmployeeStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    ON_LEAVE = "on_leave", "On Leave"
    EXITED = "exited", "Exited"


class EmploymentType(models.TextChoices):
    FULL_TIME = "full_time", "Full time"
    PART_TIME = "part_time", "Part time"
    CONTRACT = "contract", "Contract"
    INTERN = "intern", "Intern"


class WorkMode(models.TextChoices):
    """Where a person works — not in the roster export, so HR sets it. Default
    OFFICE; REMOTE covers permanent work-from-home."""

    OFFICE = "office", "Office"
    REMOTE = "remote", "Remote"
    HYBRID = "hybrid", "Hybrid"


class RoleArchetype(models.TextChoices):
    """Which of the frontend's 3 known UI archetypes a role renders as —
    confirmed against the actual frontend source (frontend/src/lib/auth/
    usePermission.ts's RequiredRole type and frontend/src/app/(app)/layout.tsx's
    nav `roles` arrays), not the 4-archetype guess docs/TASKS.md P1-E3-01
    originally made before anyone had read that code. There is no frontend
    concept of "manager" or "finance" — `superadmin` is the one that gates the
    org-wide Organization page (`requireOrgScope`), one tier above `admin`.
    Every role, starter or custom, must declare one of these 3."""

    EMPLOYEE = "employee", "Employee"
    ADMIN = "admin", "Admin"
    SUPERADMIN = "superadmin", "Super Admin"
