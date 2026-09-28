"""The approval lifecycle, in one place. Each transition validates the actor and
the current state (terminal states never move again), records the decision, and
fans out through the other primitives: notify() the affected party (#5) and
write_audit() the change (#4)."""

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.service import write_audit
from notifications.service import notify

from .models import Request, RequestStatus
from .signals import request_decided


def _approver_for(requester_user):
    """The requester's manager's account, or None (→ unassigned, HR reassigns)."""
    employee = getattr(requester_user, "employee", None)
    manager = getattr(employee, "manager", None)
    return getattr(manager, "user", None) if manager else None


def create_request(requester_user, request_type: str, payload: dict, approver_user=None) -> Request:
    approver = approver_user if approver_user is not None else _approver_for(requester_user)
    request = Request.objects.create(
        request_type=request_type,
        requester=requester_user,
        approver=approver,
        payload=payload or {},
    )
    if approver is not None:
        notify(approver, f"{request_type}.requested", f"New {request_type} request to review")
    write_audit(requester_user, "Request.created", "Request", request.pk, {"after": request_type})
    return request


def _finalize(request: Request, actor, status: str, note: str) -> Request:
    if request.is_terminal:
        raise ValidationError("This request has already been resolved.")
    request.status = status
    request.decision_note = note or ""
    request.decided_by = actor
    request.decided_at = timezone.now()
    request.save(
        update_fields=["status", "decision_note", "decided_by", "decided_at", "updated_at"]
    )
    notify(
        request.requester,
        f"{request.request_type}.{status}",
        f"Your {request.request_type} was {status}",
    )
    write_audit(actor, f"Request.{status}", "Request", request.pk, {"note": note or ""})
    # Let the originating module apply its effect (deduct balance, mark WFH…).
    # Fired once, after the transition is persisted, so a receiver sees final state.
    request_decided.send(sender=Request, request=request, actor=actor, status=status)
    return request


def decide(request: Request, actor, status: str, note: str = "") -> Request:
    """Approve or reject — only the named approver may, and only while pending."""
    if status not in (RequestStatus.APPROVED, RequestStatus.REJECTED):
        raise ValidationError("A decision must be approve or reject.")
    if request.approver_id != actor.pk:
        raise PermissionDenied("Only the assigned approver can decide this request.")
    return _finalize(request, actor, status, note)


def withdraw(request: Request, actor) -> Request:
    """The requester cancels their own pending request."""
    if request.requester_id != actor.pk:
        raise PermissionDenied("Only the requester can withdraw this request.")
    return _finalize(request, actor, RequestStatus.WITHDRAWN, "Withdrawn by requester")


def reassign(request: Request, new_approver) -> Request:
    """HR points a stuck pending request at a different approver."""
    if request.is_terminal:
        raise ValidationError("A resolved request cannot be reassigned.")
    request.approver = new_approver
    request.save(update_fields=["approver", "updated_at"])
    if new_approver is not None:
        notify(new_approver, f"{request.request_type}.requested", "A request was assigned to you")
    return request


def force_resolve(request: Request, actor, status: str, note: str = "") -> Request:
    """HR resolves directly, bypassing the approver — the escape hatch."""
    if status not in (RequestStatus.APPROVED, RequestStatus.REJECTED):
        raise ValidationError("A forced resolution must be approve or reject.")
    return _finalize(request, actor, status, note or "Resolved by an administrator")
