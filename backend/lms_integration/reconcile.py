"""Identity reconciliation (Data Mapping §4, UAT-12).

Compares HRMS employees with LMS learners and reports every mismatch. With
provision=True it also queues the fix for the safe cases (provision the
unlinked, deactivate the exited). It never touches LMS-owned learning data
and never resolves a duplicate link on its own — conflicts are reported for
a person to decide."""

from django.db import transaction
from django.utils import timezone

from audit.service import write_audit
from employees.models import Employee
from lms_integration import events
from lms_integration.client import LmsClient, LmsNotConfigured
from lms_integration.models import (
    EventDirection,
    IntegrationEvent,
    LinkStatus,
    LmsIdentityLink,
    ReconciliationRun,
    SyncStatus,
)

UNLINKED_ACTIVE = "unlinked_active"
EXITED_WITH_ACCESS = "exited_with_access"
LINK_CONFLICT = "link_conflict"
MISSING_MAPPING = "missing_mapping"
LMS_UNKNOWN_EMPLOYEE = "lms_unknown_employee"
LMS_LEARNER_MISMATCH = "lms_learner_mismatch"
LMS_STATUS_MISMATCH = "lms_status_mismatch"
STUCK_SYNC = "stuck_sync"


def _employee_ref(employee):
    return {
        "employee_id": employee.pk,
        "employee_code": employee.employee_code,
        "employee_name": employee.full_name,
        "status": employee.status,
    }


def _fetch_lms_learners(client):
    """All learners the LMS knows as HRMS-linked, or None when the LMS cannot
    be asked (not configured / unreachable) — the HRMS-side checks still run."""
    learners, page = [], 0
    while True:
        response = client.list_learners(page=page)
        if not response.ok:
            raise RuntimeError(response.error or "LMS learner listing failed")
        body = (
            response.data.get("data")
            if isinstance(response.data.get("data"), dict)
            else response.data
        )
        items = body.get("items") or []
        learners.extend(items)
        if not body.get("has_more") or not items or page > 1000:
            return learners
        page += 1


def reconcile(*, actor=None, provision=False, trigger="manual", client=None) -> ReconciliationRun:
    run = ReconciliationRun.objects.create(started_by=actor, trigger=trigger, provision=provision)
    findings, actions = [], {"provisioned": 0, "deactivations_queued": 0}
    lms_note = None
    try:
        employees = Employee.objects.select_related("department", "designation", "lms_link")
        links = {link.employee_id: link for link in LmsIdentityLink.objects.all()}

        for employee in employees:
            link = links.get(employee.pk)
            eligible = employee.status in events.PROVISIONED_STATUSES
            if eligible and (link is None or link.status == LinkStatus.DEACTIVATED):
                findings.append({"type": UNLINKED_ACTIVE, **_employee_ref(employee)})
                if provision:
                    with transaction.atomic():
                        if events.provision(employee, actor=actor):
                            actions["provisioned"] += 1
            elif (
                employee.status == "exited"
                and link
                and link.status in (LinkStatus.LINKED, LinkStatus.PENDING)
            ):
                open_exit = IntegrationEvent.objects.filter(
                    employee=employee,
                    direction=EventDirection.OUTBOUND,
                    event_type=events.EMPLOYEE_STATUS_CHANGED,
                    status__in=(SyncStatus.PENDING, SyncStatus.RETRYING, SyncStatus.PROCESSING),
                ).exists()
                findings.append(
                    {
                        "type": EXITED_WITH_ACCESS,
                        **_employee_ref(employee),
                        "exit_queued": open_exit,
                    }
                )
                if provision and not open_exit:
                    with transaction.atomic():
                        events.enqueue(employee, events.EMPLOYEE_STATUS_CHANGED, actor=actor)
                        actions["deactivations_queued"] += 1
            if link and link.status == LinkStatus.CONFLICT:
                findings.append(
                    {"type": LINK_CONFLICT, **_employee_ref(employee), "message": link.last_error}
                )
            if eligible:
                missing = [
                    f for f in ("department", "designation") if getattr(employee, f"{f}_id") is None
                ]
                if missing:
                    findings.append(
                        {"type": MISSING_MAPPING, **_employee_ref(employee), "missing": missing}
                    )

        stuck = IntegrationEvent.objects.filter(
            direction=EventDirection.OUTBOUND, status=SyncStatus.FAILED
        ).select_related("employee")
        for event in stuck[:500]:
            findings.append(
                {
                    "type": STUCK_SYNC,
                    "event_id": event.event_id,
                    "event_type": event.event_type,
                    "employee_id": event.employee_id,
                    "error": event.last_error,
                }
            )

        # LMS-side comparison.
        client = client or LmsClient()
        try:
            learners = _fetch_lms_learners(client)
        except LmsNotConfigured:
            learners, lms_note = None, "LMS not configured; HRMS-side checks only."
        except Exception as exc:  # noqa: BLE001
            learners, lms_note = None, f"LMS unavailable ({exc}); HRMS-side checks only."
        if learners is not None:
            by_pk = {e.pk: e for e in employees}
            for learner in learners:
                ext = str(learner.get("employee_id") or learner.get("external_employee_id") or "")
                learner_id = str(learner.get("learner_id") or "")
                employee = by_pk.get(int(ext)) if ext.isdigit() else None
                if employee is None:
                    findings.append(
                        {"type": LMS_UNKNOWN_EMPLOYEE, "learner_id": learner_id, "employee_id": ext}
                    )
                    continue
                link = links.get(employee.pk)
                if link and link.learner_id and learner_id and link.learner_id != learner_id:
                    findings.append(
                        {
                            "type": LMS_LEARNER_MISMATCH,
                            **_employee_ref(employee),
                            "hrms_learner_id": link.learner_id,
                            "lms_learner_id": learner_id,
                        }
                    )
                lms_active = str(learner.get("status") or "").upper() in (
                    "ACTIVE",
                    "ENABLED",
                    "TRUE",
                )
                if employee.status == "exited" and lms_active:
                    findings.append(
                        {
                            "type": LMS_STATUS_MISMATCH,
                            **_employee_ref(employee),
                            "lms_status": learner.get("status"),
                        }
                    )

        counts = {}
        for finding in findings:
            counts[finding["type"]] = counts.get(finding["type"], 0) + 1
        run.findings = findings
        run.summary = {
            "counts": counts,
            "total": len(findings),
            "actions": actions,
            "lms": lms_note or "compared",
        }
        run.status = ReconciliationRun.STATUS_COMPLETED
    except Exception as exc:  # noqa: BLE001
        run.status = ReconciliationRun.STATUS_FAILED
        run.error = str(exc)[:2000]
    run.finished_at = timezone.now()
    run.save()
    write_audit(
        actor,
        "LmsReconciliation.run",
        "ReconciliationRun",
        run.pk,
        {"provision": provision, "status": run.status, "summary": run.summary},
    )
    return run
