"""LMS integration permissions (PRD §5, Implementation plan §2).

- lms.read    learning data (courses, assessments, certifications, skills)
              within scope. SELF for Employee puts it in every employee's
              baseline, so everyone sees their own Learning tab.
- lms.launch  open the LMS through SSO. Flat capability; the token only ever
              names the caller, so SELF is the only meaningful tier.
- lms.admin   integration admin: sync health, retries, manual links and
              reconciliation."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

ALL = ScopeTier.ALL

register_module(
    ModuleSpec(
        key="lms",
        label="Learning (LMS)",
        enabled=True,
        permissions=(
            PermissionSpec(
                "lms.read",
                "View learning progress, certifications and skills within the holder's scope",
                label="View learning records",
                group="Learning (LMS)",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ALL,
                    "Auditor": ALL,
                },
            ),
            PermissionSpec(
                "lms.launch",
                "Open the LMS from HRMS using single sign-on",
                label="Open the LMS",
                group="Learning (LMS)",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.SELF,
                    "HR Admin": ScopeTier.SELF,
                },
            ),
            PermissionSpec(
                "lms.admin",
                "Administer the LMS integration: sync health, retries, links, reconciliation",
                label="Manage LMS integration",
                group="Learning (LMS)",
                default_grants={"HR Admin": ALL},
            ),
        ),
    )
)
