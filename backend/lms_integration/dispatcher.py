"""Delivers queued outbound events to the LMS (the outbox relay).

Run by `manage.py lms_dispatch` (cron / a small loop process). Safe to run
several copies at once: each event is claimed under SELECT ... FOR UPDATE
SKIP LOCKED, and the HTTP call happens outside any transaction.

Per employee, events are delivered strictly in order: an event waits while
an older one for the same employee is still open. A FAILED event does not
block later ones — each carries the full snapshot, so the next delivery
supersedes it."""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from audit.service import write_audit
from lms_integration.client import LmsClient
from lms_integration.models import (
    OPEN_STATUSES,
    EventDirection,
    IntegrationDelivery,
    IntegrationEvent,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
)

logger = logging.getLogger(__name__)

BASE_BACKOFF_SECONDS = 30
MAX_BACKOFF_SECONDS = 6 * 60 * 60
# A PROCESSING row older than this belongs to a worker that died mid-send.
STALE_PROCESSING = timedelta(minutes=10)


def backoff(attempt: int) -> timedelta:
    return timedelta(
        seconds=min(BASE_BACKOFF_SECONDS * 2 ** max(attempt - 1, 0), MAX_BACKOFF_SECONDS)
    )


def _due_ids(now, limit):
    due = Q(status__in=[SyncStatus.PENDING, SyncStatus.RETRYING], next_attempt_at__lte=now) | Q(
        status=SyncStatus.PROCESSING, updated_at__lt=now - STALE_PROCESSING
    )
    return list(
        IntegrationEvent.objects.filter(due, direction=EventDirection.OUTBOUND)
        .order_by("id")
        .values_list("id", flat=True)[:limit]
    )


def _claim(event_id, now):
    """Lock the row and mark it PROCESSING, or return None if another worker
    has it, it is no longer due, or an older event for the employee is open."""
    with transaction.atomic():
        event = (
            IntegrationEvent.objects.select_for_update(skip_locked=True).filter(pk=event_id).first()
        )
        if event is None:
            return None
        stale = event.status == SyncStatus.PROCESSING and event.updated_at < now - STALE_PROCESSING
        if not stale and (
            event.status not in (SyncStatus.PENDING, SyncStatus.RETRYING)
            or (event.next_attempt_at and event.next_attempt_at > now)
        ):
            return None
        if event.employee_id and (
            IntegrationEvent.objects.filter(
                direction=EventDirection.OUTBOUND,
                employee_id=event.employee_id,
                id__lt=event.id,
                status__in=OPEN_STATUSES,
            ).exists()
        ):
            return None
        event.status = SyncStatus.PROCESSING
        event.attempt_count += 1
        event.save(update_fields=["status", "attempt_count", "updated_at"])
        return event


def _learner_id_from(data: dict):
    for source in (data, data.get("data") if isinstance(data.get("data"), dict) else {}):
        value = source.get("learner_id") or source.get("learnerId")
        if value not in (None, ""):
            return str(value)
    return None


def _apply_success(event, response, now):
    event.status = SyncStatus.SUCCEEDED
    event.processed_at = now
    event.last_error = ""
    event.next_attempt_at = None
    if not event.employee_id:
        return
    link, _ = LmsIdentityLink.objects.get_or_create(employee_id=event.employee_id)
    learner_id = _learner_id_from(response.data)
    exited = (event.payload.get("employee") or {}).get("employment_status") == "EXITED"

    if learner_id and link.learner_id and link.learner_id != learner_id:
        _conflict(
            event,
            link,
            f"LMS answered learner {learner_id}, but this employee is linked to {link.learner_id}.",
        )
        return
    if learner_id and not link.learner_id:
        if LmsIdentityLink.objects.filter(learner_id=learner_id).exclude(pk=link.pk).exists():
            _conflict(
                event, link, f"LMS learner {learner_id} is already linked to another employee."
            )
            return
        link.learner_id = learner_id
        link.linked_at = now
    if exited:
        link.status = LinkStatus.DEACTIVATED
    elif link.learner_id:
        link.status = LinkStatus.LINKED
    link.last_synced_at = now
    link.last_error = ""
    try:
        with transaction.atomic():
            link.save()
    except IntegrityError:  # lost a race for the same learner_id
        _conflict(
            event,
            LmsIdentityLink.objects.get(pk=link.pk),
            f"LMS learner {learner_id} is already linked.",
        )


def _conflict(event, link, message):
    """Duplicate links are never resolved silently (Data Mapping §4)."""
    event.status = SyncStatus.FAILED
    event.last_error = message
    link.status = LinkStatus.CONFLICT
    link.last_error = message
    link.save(update_fields=["status", "last_error", "updated_at"])
    write_audit(None, "LmsIdentityLink.conflict", "LmsIdentityLink", link.pk, {"message": message})


def _apply_failure(event, response, now, max_attempts):
    event.last_error = response.error[:2000]
    if response.transient and event.attempt_count < max_attempts:
        event.status = SyncStatus.RETRYING
        event.next_attempt_at = now + backoff(event.attempt_count)
    else:
        event.status = SyncStatus.FAILED
        event.next_attempt_at = None
    if event.employee_id:
        LmsIdentityLink.objects.filter(employee_id=event.employee_id).update(
            last_error=event.last_error
        )


def deliver(event, client, now=None):
    """Send one already-claimed event and record the outcome."""
    response = client.send_event(event.payload)
    now = now or timezone.now()
    with transaction.atomic():
        IntegrationDelivery.objects.create(
            event=event,
            target=client.url("/integrations/hrms/events"),
            attempt_no=event.attempt_count,
            succeeded=response.ok,
            http_status=response.http_status,
            error=response.error[:2000],
            duration_ms=response.duration_ms,
        )
        # 409 = the LMS already applied this event_id: idempotent success.
        if response.ok or response.http_status == 409:
            _apply_success(event, response, now)
        else:
            _apply_failure(event, response, now, settings.LMS_MAX_ATTEMPTS)
        event.save()
    return event


def dispatch_due(limit: int = 100, client: LmsClient | None = None) -> dict:
    client = client or LmsClient()
    counts = {"claimed": 0, "succeeded": 0, "retrying": 0, "failed": 0}
    if not client.configured:
        counts["skipped"] = "LMS_BASE_URL / LMS_OUTBOUND_SECRET not set"
        return counts
    now = timezone.now()
    for event_id in _due_ids(now, limit):
        event = _claim(event_id, now)
        if event is None:
            continue
        counts["claimed"] += 1
        try:
            deliver(event, client)
        except Exception as exc:  # noqa: BLE001 — one bad event must not stop the batch
            logger.exception("LMS: delivering %s failed", event.event_id)
            IntegrationEvent.objects.filter(pk=event.pk).update(
                status=SyncStatus.RETRYING,
                next_attempt_at=timezone.now() + backoff(event.attempt_count),
                last_error=f"Internal error: {exc}"[:2000],
            )
            counts["retrying"] += 1
            continue
        key = {SyncStatus.SUCCEEDED: "succeeded", SyncStatus.RETRYING: "retrying"}.get(
            event.status, "failed"
        )
        counts[key] += 1
    return counts


def retry(event, actor=None):
    """Integration Admin "retry": give a FAILED/RETRYING outbound event a
    fresh attempt budget and make it due now."""
    event.status = SyncStatus.PENDING
    event.attempt_count = 0
    event.next_attempt_at = timezone.now()
    event.save(update_fields=["status", "attempt_count", "next_attempt_at", "updated_at"])
    write_audit(
        actor,
        "IntegrationEvent.retried",
        "IntegrationEvent",
        event.pk,
        {"event_id": event.event_id},
    )
    return event
