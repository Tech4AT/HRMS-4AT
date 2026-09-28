# Building Leave & Attendance on the Approvals Engine

The approval workflow is done and tested on the **RBAC** branch. Build your
modules **on RBAC** (not your old branch) and wire them to the engine — do not
write your own approve/route/notify code. The engine handles the whole
lifecycle: raise → route to the requester's manager → approve/reject/withdraw →
notify + audit → fire a signal. You write only your module's data and rules.

Reference implementation to copy: `backend/example_leave/`. Full contract:
`backend/approvals/README.md`.

## The 3 touch points

**1. Raise a request** — in your `perform_create` (or wherever the employee
submits), after saving your own row:

```python
from approvals import service as approvals

approvals.create_request(
    self.request.user,
    "leave",                       # your request_type; use a distinct one per module
    {"leave_request_id": row.pk},  # payload: whatever you need to apply the decision
)
```

The approver is auto-routed to the requester's manager. You pass nothing about
who approves.

**2. Decide** — nothing to build. The manager acts through the existing
inbox UI / endpoints:

```
POST /api/requests/{id}/approve
POST /api/requests/{id}/reject
POST /api/requests/{id}/withdraw
```

**3. React to the decision** — a signal receiver in your app applies the
effect. Copy `example_leave/handlers.py`:

```python
from django.dispatch import receiver
from approvals.signals import request_decided

@receiver(request_decided)
def apply_leave_decision(sender, request, actor, status, **kwargs):
    if request.request_type != "leave":     # ignore other modules' decisions
        return
    row_id = (request.payload or {}).get("leave_request_id")
    if not row_id:
        return
    # status is one of: approved | rejected | withdrawn
    LeaveRequest.objects.filter(pk=row_id).update(status=...)
```

Register it in `apps.py`:

```python
def ready(self):
    from . import handlers  # noqa: F401
```

## What's yours vs. the engine's

- **Yours:** leave types, balances/accrual, the attendance calendar/shifts,
  validation (overlaps, balance available) — all your module's logic.
- **Engine's (free):** raise → route → decide → notify → audit → signal, plus
  scope-filtered lists (`GET /api/requests`) and the approvals inbox UI.

## Notes

- One `request_type` string per flow (`"leave"`, `"wfh"`,
  `"attendance_regularization"`, …). Filter on it in your receiver so you only
  act on your own decisions.
- The decision is applied via the signal, so you never call the approve
  endpoint yourself — `example_leave` proves this end to end.
- Verify your wiring with the same pattern as
  `example_leave/tests/test_approvals_integration.py`.
