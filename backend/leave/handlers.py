"""The consumer side of the approvals engine (docs/LEAVE-ATTENDANCE-
INTEGRATION.md), for the requires_approval=True path only — see
apps.py/views.py for why an auto-approved LeaveType never raises a Request at
all and so never reaches this receiver."""

from django.dispatch import receiver
from django.utils import timezone

from approvals.signals import request_decided

from .models import LeaveBalance, LeaveRequest, LeaveRequestStatus

# approvals status -> our LeaveRequest.status
_STATUS = {
    "approved": LeaveRequestStatus.APPROVED,
    "rejected": LeaveRequestStatus.REJECTED,
    "withdrawn": LeaveRequestStatus.CANCELLED,
}


@receiver(request_decided)
def apply_leave_decision(sender, request, actor, status, **kwargs):
    if request.request_type != "leave":
        return  # not ours — every module's decisions come through this signal
    row_id = (request.payload or {}).get("leave_request_id")
    if not row_id:
        return
    row = LeaveRequest.objects.filter(pk=row_id).first()
    if row is None:
        return

    row.status = _STATUS.get(status, row.status)
    row.decided_at = timezone.now()
    row.save(update_fields=["status", "decided_at", "updated_at"])

    # Release the pending hold raised at submission time; approved additionally
    # converts it into a real deduction. Rejected/withdrawn just releases it.
    balance = LeaveBalance.objects.filter(
        employee=row.employee, leave_type=row.leave_type, financial_year=row.financial_year
    ).first()
    if balance is None:
        return
    balance.pending = max(balance.pending - row.duration_days, 0)
    if row.status == LeaveRequestStatus.APPROVED:
        balance.used += row.duration_days
    balance.save(update_fields=["pending", "used", "updated_at"])
