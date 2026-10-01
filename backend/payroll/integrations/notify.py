"""Payroll notifications through the shared notifications primitive (#5).
No-ops when the notifications app is not installed."""

from django.apps import apps


def notify_user(user, kind, title, body=None):
    if user is None or not apps.is_installed("notifications"):
        return
    from notifications.service import notify

    notify(user, f"payroll.{kind}", title, body)


def payslips_released(slips, period_label):
    for slip in slips:
        user = getattr(slip.employee, "user", None)
        notify_user(
            user,
            "payslip_released",
            f"Your payslip for {period_label} is available",
            "Open My Finances to view and download it.",
        )


def run_finalized(run):
    period = run.period
    notify_user(
        run.submitted_by,
        "run_finalized",
        f"Payroll {period.year}-{period.month:02d} ({period.pay_group.name}) was finalized",
    )
