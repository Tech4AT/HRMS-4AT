# Approvals — core primitive #3

One generic engine for every approve/reject flow: leave, WFH, expense, asset,
exit. Your module does **not** re-implement approvals — it raises a typed
request and reacts to the decision. Four touch points, nothing more.

## The contract (build your module against these)

### 1. Raise a request
```python
from approvals import service

req = service.create_request(
    requester_user=request.user,
    request_type="leave",              # your flow's name; you own the string
    payload={"leave_type": "casual",   # your flow's fields, free-form JSON
             "from": "2026-10-01", "to": "2026-10-03"},
    # approver_user=...                 # optional; defaults to requester's manager
)
```
- Approver defaults to the requester's **manager's** user. No manager → `approver` is `None` (unassigned; HR reassigns). You can override with `approver_user`.
- The approver is notified automatically; the create is audit-logged.
- **Validate your payload in your own view before calling this.** The engine
  does not know your rules (overlapping dates, balance available) — that's yours.

### 2. The manager decides (HTTP, already built — you write no code)
```
POST /api/requests/{id}/approve   {"note": "ok"}
POST /api/requests/{id}/reject    {"note": "no coverage"}
POST /api/requests/{id}/withdraw            # requester cancels their own
POST /api/requests/{id}/reassign  {"approver": <user_id>}   # needs approvals.manage
POST /api/requests/{id}/resolve   {"status":"approved","note":""}  # HR force-resolve
```
Only the assigned approver can approve/reject; only the requester can withdraw.
The requester is notified of the outcome; every transition is audit-logged.

### 3. React to the decision — **this is how your module applies its effect**
The manager approves through the *generic* endpoint, so your module is not in
that call path. Listen for the signal instead:
```python
from django.dispatch import receiver
from approvals.signals import request_decided

@receiver(request_decided)
def apply_leave(sender, request, actor, status, **kwargs):
    if request.request_type != "leave" or status != "approved":
        return
    deduct_balance(request.requester, request.payload)   # your logic
```
- Fires **once**, after the transition is persisted (state is final when you see it).
- `status` is `"approved"`, `"rejected"`, or `"withdrawn"`.
- Filter on `request.request_type` — you'll receive every module's decisions.
- Connect it in your app's `apps.py::ready()` so it's registered at startup.

### 4. List requests (HTTP, already built)
```
GET /api/requests/         # you see requests you raised or must approve;
                           # holders of approvals.manage see all
```

## What the engine guarantees
- Lifecycle: `pending` → `approved` / `rejected` / `withdrawn`. Terminal is final
  (a resolved request never transitions again).
- Authority: approver-only decisions, requester-only withdraw, `approvals.manage`
  for oversight (reassign / force-resolve).
- Every transition fans out to notifications (#5) and audit (#4) for free.

## What is NOT the engine's job (it's yours)
- Your domain rules and validation (balances, overlaps, limits).
- Your domain data (leave types, balances, the calendar) — keep it in your app.
- Applying the effect of a decision — do it in the `request_decided` receiver.

## Permissions
`approvals.manage` (granted to HR Admin + Finance at ALL scope) = see everything,
reassign, force-resolve. Raising a request and acting as its own approver /
requester needs no permission — that authority is inherent in the role on the row.
