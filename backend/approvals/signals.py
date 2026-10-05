"""The cross-boundary hook. A manager approves through the *generic* approvals
endpoint, so the module that raised the request (leave, attendance, expense) is
not in that call path and needs a way to hear the outcome and apply its effect
— deduct a leave balance, mark a WFH day, release a reserved asset.

`request_decided` fires exactly once, when a request reaches a terminal state
(approved / rejected / withdrawn). A consumer connects a receiver, filters on
`request.request_type`, and acts. Kept as one Django signal (not three) so the
sender is one line; the receiver switches on `status`.

    from approvals.signals import request_decided
    from django.dispatch import receiver

    @receiver(request_decided)
    def apply_leave(sender, request, actor, status, **kwargs):
        if request.request_type != "leave" or status != "approved":
            return
        deduct_balance(request.requester, request.payload)
"""

import django.dispatch

# kwargs: request (the Request), actor (who decided / withdrew), status (str)
request_decided = django.dispatch.Signal()
