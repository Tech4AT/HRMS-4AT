"""The consumer side of the approvals engine (core primitive #3). When a manager
decides an approval Request that this module raised, the engine fires
`request_decided`; we hear it here and apply the effect to our own row. This is
the plug-and-play proof: example_leave never touches the approvals endpoint —
it only raises a request and reacts to the outcome."""

from django.dispatch import receiver

from approvals.signals import request_decided

from .models import LeaveRequest

# approvals status -> our LeaveRequest.status
_STATUS = {"approved": "approved", "rejected": "rejected", "withdrawn": "cancelled"}


@receiver(request_decided)
def apply_leave_decision(sender, request, actor, status, **kwargs):
    if request.request_type != "example_leave":
        return  # not ours — every module's decisions come through this signal
    leave_id = (request.payload or {}).get("leave_request_id")
    if not leave_id:
        return
    LeaveRequest.objects.filter(pk=leave_id).update(status=_STATUS.get(status, status))
