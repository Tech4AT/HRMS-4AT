"""Payroll permissions and the default scope each role gets (PRD §8 Roles and
Permissions). Admins can change these later; re-running migrate never
overwrites their changes (see core/registry.py).

Maker-checker is expressed through separate codes: preparing a run
(payroll.process), Finance review (payroll.review), final approval
(payroll.approve), finalize (payroll.finalize) and the privileged reopen
(payroll.reopen) are distinct, so no single starter role can prepare and
approve the same payroll unless an admin deliberately grants both."""

from core.enums import ScopeTier
from core.registry import ModuleSpec, PermissionSpec, register_module, register_permissions

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


# ---------------------------------------------------------------------------
# Fine-grained Employee Finance + Payroll Admin privileges (catalog mirrored
# from the HR reference UI). These give the role builder two granular groups
# alongside the coarse payroll.* codes above. Scope badges shown in the
# reference UI (Paygroup Only / Legal Entity Only) are recorded in each
# description; we grant HR Admin ALL since we have no paygroup scope tier.
# ---------------------------------------------------------------------------
_PAY_HR = {"HR Admin": ScopeTier.ALL}

# Group: Employee Finance Privileges
register_permissions(
    PermissionSpec("finance.salary.view", "View an employee's salary details.",
                   label="View Employee Salary Details", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.salary.write", "Add or update an employee's salary details.",
                   label="Add/Update Salary Details", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.payslips.view", "View an employee's payslips.",
                   label="View employee Payslips", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.income_tax.view", "View an employee's income tax details.",
                   label="View IncomeTaxDetails", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.form124.access", "Access Form 124.",
                   label="Access Form 124", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.form130.access", "Access Form 130.",
                   label="Access Form 130", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.tax_declarations.view", "View employees' income tax declarations.",
                   label="View employee income tax declarations", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.tax_declarations.manage", "Manage employees' income tax declarations.",
                   label="Manage employee income tax declarations", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.declarations.delete", "Delete an employee's declarations.",
                   label="Delete Employee Declarations", group="Employee Finance Privileges", default_grants=_PAY_HR),
    PermissionSpec("finance.component_claims.view", "View employees' component claims.",
                   label="View employee component claims", group="Employee Finance Privileges", default_grants=_PAY_HR),
)

# Group: Payroll Admin
register_permissions(
    PermissionSpec("payroll_admin.component_overrides.view", "View component overrides. Scoped to paygroup.",
                   label="View Component Overrides", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.component_overrides.write", "Add, update or delete component overrides. Scoped to paygroup.",
                   label="Add/Update/Delete Component Overrides", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.tds_overrides.view", "View TDS overrides. Scoped to paygroup.",
                   label="View TDS Overrides", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.tds_overrides.write", "Add, update or delete TDS overrides. Scoped to paygroup.",
                   label="Add/Update/Delete TDS Overrides", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.investment_declarations.approve", "Approve investment declarations. Scoped to paygroup.",
                   label="Approve Investment Declarations", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.form138.view", "View Form 138. Scoped to paygroup and legal entity.",
                   label="View Form 138", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.form138.generate", "Generate Form 138. Scoped to paygroup and legal entity.",
                   label="Generate Form 138", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.form140.view", "View Form 140. Scoped to legal entity.",
                   label="View Form 140", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.form140.generate", "Generate Form 140. Scoped to legal entity.",
                   label="Generate Form 140", group="Payroll Admin", default_grants=_PAY_HR),
    PermissionSpec("payroll_admin.financial_info.view", "View financial information. Scoped to paygroup.",
                   label="View Financial Information", group="Payroll Admin", default_grants=_PAY_HR),
)
