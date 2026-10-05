"""Bridge between payroll's multi-stage approvals and the shared approvals
engine (core primitive #3) so payroll items appear in everyone's Approvals
inbox.

Payroll keeps its own rules (stage order, stage permissions, maker-checker,
audit). The engine routes one request to one named approver, so each payroll
stage is mirrored by one engine Request while that stage is pending:

- stage opens      -> open_stage() raises an engine Request for its approver
- decided in inbox -> on_request_decided() applies it through payroll's service
- decided in payroll -> close_stage() resolves the engine Request to match

Approver: the pay group's named finance_reviewer / final_approver, else the
first active user holding the stage permission who is not the preparer."""

from django.apps import apps
from django.db import transaction
from django.dispatch import receiver

STAGE_PERMISSION = {"finance_review": "payroll.review", "final_approval": "payroll.approve"}
REQUEST_TYPE = {"run": "payroll_run", "revision": "salary_revision"}
DEDICATED_ROLE = {"finance_review": "Finance Reviewer", "final_approval": "Payroll Approver"}


def engine_installed():
    return apps.is_installed("approvals")


def _stage_owner(approval):
    return ("run", approval.run) if approval.run_id else ("revision", approval.revision)


def _pay_group(kind, obj):
    if kind == "run":
        return obj.period.pay_group
    from payroll.services.people import profile_for

    profile = profile_for(obj.employee, obj.effective_from)
    return getattr(profile, "pay_group", None)


def _preparer(kind, obj):
    return obj.submitted_by if kind == "run" else obj.created_by


def choose_approver(approval):
    """The named approver for the stage, else the first eligible user."""
    from accounts.models import User
    from core.scope import user_has_permission

    kind, obj = _stage_owner(approval)
    preparer = _preparer(kind, obj)
    group = _pay_group(kind, obj)
    named = getattr(
        group, "finance_reviewer" if approval.stage == "finance_review" else "final_approver", None
    )
    code = STAGE_PERMISSION.get(approval.stage)
    already = {
        a.approver_id
        for a in approval_siblings(approval)
        if a.status == "approved" and a.sequence > 0
    }
    if (
        named
        and named.is_active
        and named.pk != getattr(preparer, "pk", None)
        and user_has_permission(named, code)
    ):
        return named
    # Prefer the stage's dedicated role (Finance Reviewer / Payroll Approver)
    # over broader roles that also hold the permission (e.g. HR Admin).
    dedicated = DEDICATED_ROLE.get(approval.stage)
    candidates = [
        user
        for user in User.objects.filter(is_active=True, roles__isnull=False)
        .distinct()
        .prefetch_related("roles")
        .order_by("id")
        if user.pk != getattr(preparer, "pk", None)
        and user.pk not in already
        and user_has_permission(user, code)
    ]
    candidates.sort(key=lambda user: 0 if any(r.name == dedicated for r in user.roles.all()) else 1)
    return candidates[0] if candidates else None


def approver_candidates():
    """Users who may act on each stage, for the pay-group approver pickers."""
    from accounts.models import User
    from core.scope import user_has_permission

    users = (
        User.objects.filter(is_active=True, roles__isnull=False)
        .distinct()
        .prefetch_related("roles")
    )
    out = {}
    for stage, code in STAGE_PERMISSION.items():
        out[stage] = [
            {
                "value": u.pk,
                "label": f"{u.get_full_name() or u.email} "
                f"({', '.join(sorted(r.name for r in u.roles.all()))})",
            }
            for u in users.order_by("first_name", "email")
            if user_has_permission(u, code)
        ]
    return out


def approval_siblings(approval):
    kind, obj = _stage_owner(approval)
    return list(obj.approvals.all())


def _summary(kind, obj):
    if kind == "run":
        period = obj.period
        return {
            "title": (
                f"Payroll {period.year}-{period.month:02d} ({period.pay_group.name}) "
                f"run #{obj.run_no}"
            ),
            "period_id": str(period.pk),
            "run_id": str(obj.pk),
            "net_total": str(obj.net_total),
            "employees": obj.employee_count,
            "link": f"/payroll/run/{period.pk}?step=review",
        }
    return {
        "title": (
            f"Salary revision for {obj.employee.employee_code}: CTC {obj.annual_ctc} "
            f"from {obj.effective_from}"
        ),
        "revision_id": str(obj.pk),
        "employee_id": obj.employee_id,
        "annual_ctc": str(obj.annual_ctc),
        "effective_from": obj.effective_from.isoformat(),
        "link": f"/payroll/compensation/{obj.employee_id}",
    }


def open_stage(approval):
    """Raise the engine Request for a newly pending payroll stage."""
    if not engine_installed() or approval.status != "pending" or approval.inbox_request_id:
        return None
    from approvals.service import create_request

    kind, obj = _stage_owner(approval)
    approver = choose_approver(approval)
    preparer = _preparer(kind, obj)
    if approver is None or preparer is None:
        return None  # nobody eligible: payroll's own screens still handle it
    request = create_request(
        preparer,
        REQUEST_TYPE[kind],
        {
            **_summary(kind, obj),
            "stage": approval.stage,
            "stage_label": approval.get_stage_display(),
            "payroll_approval_id": str(approval.pk),
        },
        approver_user=approver,
    )
    approval.inbox_request = request
    approval.save(update_fields=["inbox_request"])
    return request


def open_next_stage(owner):
    pending = owner.approvals.filter(status="pending").order_by("sequence").first()
    if pending is not None:
        open_stage(pending)


def close_stage(approval, actor, decision, note=""):
    """Resolve the engine Request after a decision taken in payroll itself."""
    request = approval.inbox_request
    if request is None or request.is_terminal:
        return
    from approvals.models import RequestStatus
    from approvals.service import decide, force_resolve, withdraw

    if decision == "cancel":
        withdraw(request, request.requester)
        return
    status = RequestStatus.APPROVED if decision == "approve" else RequestStatus.REJECTED
    if request.approver_id == actor.pk:
        decide(request, actor, status, note)
    else:
        force_resolve(request, actor, status, note or "Decided in Payroll")


def cancel_open(owner, actor):
    for approval in owner.approvals.filter(status="pending", inbox_request__isnull=False):
        close_stage(approval, actor, "cancel")


if engine_installed():
    from approvals.signals import request_decided

    @receiver(request_decided, dispatch_uid="payroll_approvals_bridge")
    def on_request_decided(sender, request, actor, status, **kwargs):
        """A decision in the shared inbox: apply it through payroll's service
        (which re-checks stage permission, maker-checker and state)."""
        if request.request_type not in REQUEST_TYPE.values() or status not in (
            "approved",
            "rejected",
        ):
            return
        from core.scope import user_has_permission
        from payroll import models as m
        from payroll.services import people, runs

        approval = m.PayrollApproval.objects.filter(inbox_request=request).first()
        if approval is None or approval.status != "pending":
            return  # already decided inside payroll (close_stage) — nothing to do
        decision = "approve" if status == "approved" else "reject"
        note = request.decision_note or (
            "Approved in Approvals inbox" if decision == "approve" else ""
        )
        if decision == "reject" and not note.strip():
            note = "Rejected in Approvals inbox"
        from rest_framework.exceptions import PermissionDenied, ValidationError

        from payroll.services.common import PayrollError

        try:
            with transaction.atomic():
                if approval.run_id:
                    runs.decide(
                        approval.run, actor, decision, note, user_has_permission, from_inbox=True
                    )
                else:
                    people.decide_revision(
                        approval.revision,
                        actor,
                        decision,
                        note,
                        user_has_permission,
                        from_inbox=True,
                    )
        except PayrollError as exc:
            # Payroll's rules refused it (stage permission, maker-checker,
            # state). The engine already saved the decision, so put the inbox
            # request back to pending: both sides stay consistent.
            type(request).objects.filter(pk=request.pk).update(
                status="pending", decided_by=None, decided_at=None, decision_note=""
            )
            if exc.http_status == 403:
                raise PermissionDenied(f"Payroll: {exc.message}") from exc
            raise ValidationError(f"Payroll: {exc.message}") from exc
