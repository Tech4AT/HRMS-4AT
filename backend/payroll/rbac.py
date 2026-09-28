"""Payroll permissions and the default scope each role gets (PRD §8 Roles and
Permissions). Admins can change these later; re-running migrate never
overwrites their changes (see core/registry.py).

Maker-checker is expressed through separate codes: preparing a run
(payroll.process), Finance review (payroll.review), final approval
(payroll.approve), finalize (payroll.finalize) and the privileged reopen
(payroll.reopen) are distinct, so no single starter role can prepare and
approve the same payroll unless an admin deliberately grants both."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module

ALL = ScopeTier.ALL

register_module(
    ModuleSpec(
        key="payroll",
        label="Payroll",
        enabled=True,
        permissions=(
            PermissionSpec(
                "payroll.read",
                "View payroll records within the holder's scope",
                label="View payroll records",
                group="Payroll",
                default_grants={
                    "Employee": ScopeTier.SELF,
                    "Manager": ScopeTier.MANAGER,
                    "HR Admin": ALL,
                    "Finance": ALL,
                    "Payroll Admin": ALL,
                    "Finance Reviewer": ALL,
                    "Payroll Approver": ALL,
                    "Auditor": ALL,
                },
            ),
            PermissionSpec(
                "payroll.write",
                "Maintain employee payroll data: payroll profile, compensation proposals, inputs",
                label="Edit payroll records",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Finance": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.manage",
                "Manage payroll configuration: components, structures, pay groups, statutory rules",
                label="Manage payroll setup",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Finance": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.process",
                "Prepare payroll: open periods, capture inputs, calculate, submit for approval",
                label="Run payroll",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Finance": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.review",
                "Finance review stage of payroll runs and compensation revisions",
                label="Finance review",
                group="Payroll approvals",
                default_grants={"Finance": ALL, "Finance Reviewer": ALL},
            ),
            PermissionSpec(
                "payroll.approve",
                "Final approval of payroll runs and compensation revisions",
                label="Final approval",
                group="Payroll approvals",
                default_grants={"HR Admin": ALL, "Payroll Approver": ALL},
            ),
            PermissionSpec(
                "payroll.finalize",
                "Finalize and lock an approved payroll run",
                label="Finalize and lock payroll",
                group="Payroll approvals",
                default_grants={"HR Admin": ALL, "Payroll Approver": ALL},
            ),
            PermissionSpec(
                "payroll.reopen",
                "Reopen a finalized payroll (privileged; reason required)",
                label="Reopen finalized payroll",
                group="Payroll approvals",
                default_grants={"HR Admin": ALL},
            ),
            PermissionSpec(
                "payroll.release",
                "Generate and release payslips, payment files, statutory reports and journal",
                label="Release payslips and payouts",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Finance": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.override",
                "Override a calculated payroll component with a mandatory reason",
                label="Override calculated pay",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.sensitive.read",
                "See unmasked bank account, PAN and UAN values",
                label="View bank / PAN / UAN",
                group="Payroll",
                default_grants={"HR Admin": ALL, "Finance": ALL, "Payroll Admin": ALL},
            ),
            PermissionSpec(
                "payroll.audit",
                "Read the payroll audit trail and reports (read-only)",
                label="View payroll audit and reports",
                group="Payroll",
                default_grants={
                    "HR Admin": ALL,
                    "Finance": ALL,
                    "Payroll Admin": ALL,
                    "Auditor": ALL,
                },
            ),
        ),
    )
)
