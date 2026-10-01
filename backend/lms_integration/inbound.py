"""Inbound (LMS -> HRMS) events: verify, de-duplicate, project.

Envelope (API & Event Contract §2, LMS side):

    {
      "event_id": "evt_...", "event_type": "COURSE_COMPLETED", "schema_version": "1.0",
      "occurred_at": "2026-09-28T10:00:00Z", "correlation_id": "corr_...", "source": "lms",
      "employee_id": "42",          # HRMS id (the learner's external_employee_id)
      "learner_id": "9001",         # used when employee_id is absent
      "data": { ...event-specific, see HANDLERS... }
    }

Guarantees:
- idempotent: the event_id is unique; a repeat is acknowledged, not re-applied
  (UAT-10). A repeat of a FAILED event *is* re-applied, so the LMS retrying
  after a mapping was fixed just works.
- ordered by occurrence, not arrival: a projection row keeps the occurred_at
  of the event it reflects and ignores anything older.
- HRMS never invents learning facts: only these handlers write projections.
"""

import json
from datetime import datetime, time
from datetime import timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from employees.models import Employee
from lms_integration import client as signing
from lms_integration.models import (
    AssessmentResult,
    CertificationStatus,
    EmployeeCertification,
    EmployeeSkill,
    EventDirection,
    IntegrationEvent,
    LearningEnrollment,
    LearningStatus,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
)

LEARNER_LINKED = "LEARNER_LINKED"
LEARNING_ENROLLED = "LEARNING_ENROLLED"
LEARNING_PROGRESS = "LEARNING_PROGRESS"
COURSE_COMPLETED = "COURSE_COMPLETED"
ASSESSMENT_COMPLETED = "ASSESSMENT_COMPLETED"
CERTIFICATION_EARNED = "CERTIFICATION_EARNED"
CERTIFICATION_EXPIRING = "CERTIFICATION_EXPIRING"
CERTIFICATION_EXPIRED = "CERTIFICATION_EXPIRED"
SKILL_UPDATED = "SKILL_UPDATED"


class InboundError(Exception):
    def __init__(self, message, status=422, code="VALIDATION_ERROR"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


# ---------------------------------------------------------------- parsing


def _when(value, field, required=False):
    if value in (None, ""):
        if required:
            raise InboundError(f"`{field}` is required.")
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        day = parse_date(str(value))
        if day is None:
            raise InboundError(f"`{field}` is not an ISO-8601 date/time.")
        parsed = datetime.combine(day, time.min)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, dt_timezone.utc)
    return parsed


def _decimal(value, field):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise InboundError(f"`{field}` must be a number.") from None


def _text(data, field, required=False, max_length=255):
    value = data.get(field)
    if value in (None, ""):
        if required:
            raise InboundError(f"`data.{field}` is required.")
        return ""
    return str(value)[:max_length]


def _progress(value):
    if value in (None, ""):
        return None
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        raise InboundError("`data.progress` must be a number between 0 and 100.") from None


# ---------------------------------------------------------------- projection helpers


def _upsert(model, employee, key: dict, occurred_at, event_id, values: dict):
    """Create or update one projection row unless it already reflects a newer
    event. Returns the row, or None when the event was stale."""
    row = model.objects.select_for_update().filter(employee=employee, **key).first()
    if row is not None and row.source_occurred_at > occurred_at:
        return None
    if row is None:
        row = model(employee=employee, **key)
    for field, value in values.items():
        setattr(row, field, value)
    row.source_event_id = event_id
    row.source_occurred_at = occurred_at
    row.save()
    return row


def _handle_linked(employee, data, occurred_at, event_id, envelope):
    learner_id = envelope.get("learner_id") or data.get("learner_id")
    if not learner_id:
        raise InboundError("`learner_id` is required for LEARNER_LINKED.")
    learner_id = str(learner_id)
    link, _ = LmsIdentityLink.objects.select_for_update().get_or_create(employee=employee)
    if link.learner_id and link.learner_id != learner_id:
        raise InboundError(
            f"Employee is already linked to learner {link.learner_id}; resolve the conflict first.",
            status=409,
            code="CONFLICT",
        )
    if LmsIdentityLink.objects.filter(learner_id=learner_id).exclude(pk=link.pk).exists():
        raise InboundError(
            f"Learner {learner_id} is already linked to another employee.",
            status=409,
            code="CONFLICT",
        )
    link.learner_id = learner_id
    link.linked_at = link.linked_at or timezone.now()
    link.last_synced_at = timezone.now()
    if link.status in (LinkStatus.PENDING, LinkStatus.CONFLICT):
        link.status = LinkStatus.LINKED
    link.last_error = ""
    link.save()
    return {"learner_id": learner_id}


def _handle_enrolled(employee, data, occurred_at, event_id, envelope):
    course_id = _text(data, "course_id", required=True, max_length=64)
    existing = LearningEnrollment.objects.filter(employee=employee, course_id=course_id).first()
    progress = _progress(data.get("progress"))
    status = data.get("status") or (
        LearningStatus.IN_PROGRESS if progress else LearningStatus.ASSIGNED
    )
    if status not in LearningStatus.values:
        raise InboundError(f"`data.status` must be one of {', '.join(LearningStatus.values)}.")
    values = {
        "title": _text(data, "title") or (existing.title if existing else ""),
        "category": _text(data, "category", max_length=120)
        or (existing.category if existing else ""),
        "path_id": _text(data, "path_id", max_length=64) or (existing.path_id if existing else ""),
        "path_name": _text(data, "path_name") or (existing.path_name if existing else ""),
        "mandatory": bool(data.get("mandatory", existing.mandatory if existing else False)),
        "assigned_at": _when(data.get("assigned_at"), "data.assigned_at") or occurred_at,
        "due_at": _when(data.get("due_at"), "data.due_at"),
        "progress": progress if progress is not None else (existing.progress if existing else 0),
        "status": status,
    }
    if existing and existing.status == LearningStatus.COMPLETED:
        # A re-sent assignment never un-completes a course.
        values.update(status=LearningStatus.COMPLETED, progress=100)
    row = _upsert(
        LearningEnrollment, employee, {"course_id": course_id}, occurred_at, event_id, values
    )
    return {"stale": row is None}


def _handle_progress(employee, data, occurred_at, event_id, envelope):
    course_id = _text(data, "course_id", required=True, max_length=64)
    progress = _progress(data.get("progress"))
    if progress is None:
        raise InboundError("`data.progress` is required.")
    existing = LearningEnrollment.objects.filter(employee=employee, course_id=course_id).first()
    if existing and existing.status == LearningStatus.COMPLETED:
        return {"ignored": "already completed"}
    values = {
        "progress": progress,
        "status": LearningStatus.IN_PROGRESS if progress < 100 else LearningStatus.COMPLETED,
    }
    if existing is None:
        values.update(title=_text(data, "title"), assigned_at=occurred_at)
    if progress >= 100:
        values["completed_at"] = occurred_at
    row = _upsert(
        LearningEnrollment, employee, {"course_id": course_id}, occurred_at, event_id, values
    )
    return {"stale": row is None}


def _handle_completed(employee, data, occurred_at, event_id, envelope):
    course_id = _text(data, "course_id", required=True, max_length=64)
    existing = LearningEnrollment.objects.filter(employee=employee, course_id=course_id).first()
    values = {
        "status": LearningStatus.COMPLETED,
        "progress": 100,
        "completed_at": _when(data.get("completed_at"), "data.completed_at") or occurred_at,
        "score": _decimal(data.get("score"), "data.score"),
    }
    for field, length in (("title", 255), ("category", 120), ("path_id", 64), ("path_name", 255)):
        value = _text(data, field, max_length=length)
        if value:
            values[field] = value
    if existing is None:
        values.setdefault("assigned_at", occurred_at)
    row = _upsert(
        LearningEnrollment, employee, {"course_id": course_id}, occurred_at, event_id, values
    )
    return {"stale": row is None}


def _handle_assessment(employee, data, occurred_at, event_id, envelope):
    assessment_id = _text(data, "assessment_id", required=True, max_length=64)
    values = {
        "title": _text(data, "title"),
        "course_id": _text(data, "course_id", max_length=64),
        "status": _text(data, "status", max_length=30) or "completed",
        "score": _decimal(data.get("score"), "data.score"),
        "max_score": _decimal(data.get("max_score"), "data.max_score"),
        "completed_at": _when(data.get("completed_at"), "data.completed_at") or occurred_at,
    }
    row = _upsert(
        AssessmentResult, employee, {"assessment_id": assessment_id}, occurred_at, event_id, values
    )
    return {"stale": row is None}


def _certification(status):
    def handler(employee, data, occurred_at, event_id, envelope):
        certification_id = _text(data, "certification_id", required=True, max_length=64)
        existing = EmployeeCertification.objects.filter(
            employee=employee, certification_id=certification_id
        ).first()
        name = _text(data, "name") or (existing.name if existing else "")
        if not name:
            raise InboundError("`data.name` is required for a certification HRMS has not seen yet.")
        values = {"name": name, "status": status}
        for field in ("issued_at", "expires_at"):
            if field in data:
                values[field] = _when(data.get(field), f"data.{field}")
        if data.get("credential_url"):
            values["credential_url"] = _text(data, "credential_url", max_length=500)
        row = _upsert(
            EmployeeCertification,
            employee,
            {"certification_id": certification_id},
            occurred_at,
            event_id,
            values,
        )
        return {"stale": row is None}

    return handler


def _handle_skill(employee, data, occurred_at, event_id, envelope):
    skill_id = _text(data, "skill_id", required=True, max_length=64)
    evidence = data.get("evidence_refs") or []
    if not isinstance(evidence, list):
        raise InboundError("`data.evidence_refs` must be a list.")
    values = {
        "name": _text(data, "name", required=True),
        "proficiency": _text(data, "proficiency", max_length=40),
        "proficiency_score": _decimal(data.get("proficiency_score"), "data.proficiency_score"),
        "evidence_refs": evidence[:50],
    }
    row = _upsert(EmployeeSkill, employee, {"skill_id": skill_id}, occurred_at, event_id, values)
    return {"stale": row is None}


HANDLERS = {
    LEARNER_LINKED: _handle_linked,
    LEARNING_ENROLLED: _handle_enrolled,
    LEARNING_PROGRESS: _handle_progress,
    COURSE_COMPLETED: _handle_completed,
    ASSESSMENT_COMPLETED: _handle_assessment,
    CERTIFICATION_EARNED: _certification(CertificationStatus.ACTIVE),
    CERTIFICATION_EXPIRING: _certification(CertificationStatus.EXPIRING),
    CERTIFICATION_EXPIRED: _certification(CertificationStatus.EXPIRED),
    SKILL_UPDATED: _handle_skill,
}


# ---------------------------------------------------------------- entry point


def _resolve_employee(envelope):
    employee_id = envelope.get("employee_id")
    if employee_id not in (None, ""):
        employee = (
            Employee.objects.filter(pk=str(employee_id)).first()
            if str(employee_id).isdigit()
            else None
        )
        if employee is None:
            raise InboundError(
                f"No HRMS employee {employee_id}.", status=422, code="UNKNOWN_EMPLOYEE"
            )
        return employee
    learner_id = envelope.get("learner_id")
    if learner_id not in (None, ""):
        link = (
            LmsIdentityLink.objects.select_related("employee")
            .filter(learner_id=str(learner_id))
            .first()
        )
        if link is None:
            raise InboundError(
                f"Learner {learner_id} is not linked to an HRMS employee.", code="UNKNOWN_LEARNER"
            )
        return link.employee
    raise InboundError("Either `employee_id` or `learner_id` is required.")


def receive(body: bytes, headers) -> tuple[int, dict]:
    """Handle one signed LMS webhook. Returns (http_status, response_body)."""
    if not signing.verify(
        settings.LMS_INBOUND_SECRET,
        headers.get(signing.TIMESTAMP_HEADER, ""),
        headers.get(signing.SIGNATURE_HEADER, ""),
        body,
    ):
        return 401, _error("UNAUTHORIZED", "Invalid or missing webhook signature.")

    try:
        envelope = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return 400, _error("BAD_REQUEST", "Body must be JSON.")
    if not isinstance(envelope, dict):
        return 400, _error("BAD_REQUEST", "Body must be a JSON object.")

    event_id = str(envelope.get("event_id") or "")[:80]
    event_type = str(envelope.get("event_type") or "")
    if not event_id or not event_type:
        return 400, _error("BAD_REQUEST", "`event_id` and `event_type` are required.")
    try:
        occurred_at = _when(envelope.get("occurred_at"), "occurred_at", required=True)
    except InboundError as exc:
        return 400, _error("BAD_REQUEST", exc.message)

    event = _record(envelope, event_id, event_type, occurred_at)
    if event is None:
        existing = IntegrationEvent.objects.get(event_id=event_id)
        return 200, {"success": True, "data": {"duplicate": True, "status": existing.status}}

    try:
        with transaction.atomic():
            handler = HANDLERS.get(event_type)
            if handler is None:
                raise InboundError(
                    f"Unsupported event_type {event_type}.", code="UNSUPPORTED_EVENT"
                )
            employee = _resolve_employee(envelope)
            data = envelope.get("data") or {}
            if not isinstance(data, dict):
                raise InboundError("`data` must be an object.")
            result = handler(employee, data, occurred_at, event_id, envelope) or {}
            event.employee = employee
            event.status = SyncStatus.SUCCEEDED
            event.processed_at = timezone.now()
            event.last_error = ""
            event.save()
            LmsIdentityLink.objects.filter(employee=employee).update(last_synced_at=timezone.now())
    except InboundError as exc:
        IntegrationEvent.objects.filter(pk=event.pk).update(
            status=SyncStatus.FAILED, last_error=exc.message[:2000], processed_at=timezone.now()
        )
        return exc.status, _error(exc.code, exc.message)
    return 200, {
        "success": True,
        "data": {"event_id": event_id, "status": SyncStatus.SUCCEEDED, **result},
    }


def _record(envelope, event_id, event_type, occurred_at):
    """Store the event, or return None if it was already applied. A previously
    FAILED copy is reset and handed back for another go."""
    fields = dict(
        event_type=event_type[:50],
        schema_version=str(envelope.get("schema_version") or "1.0")[:10],
        direction=EventDirection.INBOUND,
        source="lms",
        correlation_id=str(envelope.get("correlation_id") or "")[:80] or f"corr_{event_id}",
        payload=envelope,
        status=SyncStatus.PROCESSING,
        occurred_at=occurred_at,
    )
    try:
        with transaction.atomic():
            return IntegrationEvent.objects.create(event_id=event_id, attempt_count=1, **fields)
    except IntegrityError:
        pass
    with transaction.atomic():
        existing = IntegrationEvent.objects.select_for_update().get(event_id=event_id)
        if existing.direction != EventDirection.INBOUND or existing.status != SyncStatus.FAILED:
            return None
        for key, value in fields.items():
            setattr(existing, key, value)
        existing.attempt_count += 1
        existing.save()
        return existing


def _error(code, message):
    return {"success": False, "error": {"code": code, "message": message}}
