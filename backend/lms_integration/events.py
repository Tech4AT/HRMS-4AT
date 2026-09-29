"""Outbound (HRMS -> LMS) events: the canonical employee payload and the outbox.

Writing an event is a row insert in the caller's own transaction — nothing
talks to the LMS here. The dispatcher (dispatcher.py) delivers later, so an
LMS outage never fails an HR transaction (PRD §6, UAT-11).

Every outbound event carries a full employee snapshot, not a diff. The LMS
applies the newest snapshot it has seen, so a lost or failed intermediate
update is healed by the next one."""

from django.conf import settings
from django.utils import timezone

from lms_integration.models import (
    EventDirection,
    IntegrationEvent,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
    new_correlation_id,
)

SCHEMA_VERSION = "1.0"

EMPLOYEE_CREATED = "EMPLOYEE_CREATED"
EMPLOYEE_UPDATED = "EMPLOYEE_UPDATED"
EMPLOYEE_STATUS_CHANGED = "EMPLOYEE_STATUS_CHANGED"
ROLE_CHANGED = "ROLE_CHANGED"
ONBOARDING_STAGE_CHANGED = "ONBOARDING_STAGE_CHANGED"

OUTBOUND_TYPES = (
    EMPLOYEE_CREATED,
    EMPLOYEE_UPDATED,
    EMPLOYEE_STATUS_CHANGED,
    ROLE_CHANGED,
    ONBOARDING_STAGE_CHANGED,
)

# HRMS employee statuses that get an LMS learner. pre_onboarding hires are
# provisioned when they become active; offer_declined never are.
PROVISIONED_STATUSES = frozenset({"active", "on_leave"})

# Employee fields whose change is worth telling the LMS about, grouped by the
# event they raise (API & Event Contract §1).
STATUS_FIELDS = ("status",)
ROLE_FIELDS = ("designation_id", "grade_id", "level_id", "position_id")
PROFILE_FIELDS = (
    "employee_code",
    "first_name",
    "last_name",
    "work_email",
    "department_id",
    "manager_id",
    "location_id",
    "date_of_joining",
)
TRACKED_FIELDS = STATUS_FIELDS + ROLE_FIELDS + PROFILE_FIELDS


def enabled() -> bool:
    return bool(getattr(settings, "LMS_INTEGRATION_ENABLED", False))


def external_employee_id(employee) -> str:
    """The stable id the LMS stores as external_employee_id. The HRMS primary
    key: it never changes, unlike the code, name or email."""
    return str(employee.pk)


def _ref(obj):
    return None if obj is None else str(obj.pk)


def _name(obj):
    return None if obj is None else obj.name


def employee_snapshot(employee) -> dict:
    """Data Mapping §1, minimised (Contract §4): identity + org references
    only. No personal details (phone, DOB, bank, ids) ever leave HRMS.
    The *_name fields are additive to v1.0 so the LMS can map HRMS org units
    onto its own Department/Designation rows without a second lookup."""
    user = getattr(employee, "user", None)
    name = employee.full_name or (user.get_full_name() if user else "") or employee.employee_code
    email = employee.work_email or (user.email if user else "") or None
    manager = employee.manager
    joined = employee.date_of_joining or employee.joining_date
    return {
        "employee_id": external_employee_id(employee),
        "employee_code": employee.employee_code,
        "name": name,
        "email": email,
        "employment_status": (employee.status or "").upper(),
        "employment_type": (employee.employment_type or "").upper(),
        "department_id": _ref(employee.department),
        "department_name": _name(employee.department),
        "designation_id": _ref(employee.designation),
        "designation_name": _name(employee.designation),
        "grade_id": _ref(employee.grade),
        "manager_employee_id": _ref(manager),
        "manager_email": (manager.work_email if manager else None) or None,
        "location_id": _ref(employee.location),
        "location_name": _name(employee.location),
        "date_of_joining": joined.isoformat() if joined else None,
        "date_of_exit": employee.date_of_exit.isoformat() if employee.date_of_exit else None,
    }


def _onboarding_stage(employee):
    try:
        profile = employee.onboarding_profile
    except Exception:  # noqa: BLE001 — RelatedObjectDoesNotExist, or app absent
        return None
    return profile.stage


def enqueue(
    employee, event_type: str, *, extra: dict | None = None, actor=None, correlation_id=None
):
    """Queue one outbound event carrying the employee's current snapshot."""
    link = getattr(employee, "lms_link", None) if employee.pk else None
    payload = {
        "event_type": event_type,
        "schema_version": SCHEMA_VERSION,
        "source": "hrms",
        "employee": employee_snapshot(employee),
        "learner_id": link.learner_id if link else None,
    }
    stage = _onboarding_stage(employee)
    if stage is not None:
        # Lets the LMS assign the onboarding path on EMPLOYEE_CREATED too, for
        # a hire whose stage moved before they were provisioned (UAT-04).
        payload["onboarding"] = {"stage": stage}
    if extra:
        payload.update(extra)
    now = timezone.now()
    event = IntegrationEvent(
        event_type=event_type,
        schema_version=SCHEMA_VERSION,
        direction=EventDirection.OUTBOUND,
        source="hrms",
        correlation_id=correlation_id or new_correlation_id(),
        employee=employee,
        payload=payload,
        status=SyncStatus.PENDING,
        next_attempt_at=now,
        occurred_at=now,
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
    )
    event.save()
    # The envelope ids live in the payload too, so what goes on the wire is
    # exactly what was stored.
    event.payload.update(
        event_id=event.event_id,
        correlation_id=event.correlation_id,
        occurred_at=now.isoformat(),
    )
    event.save(update_fields=["payload"])
    return event


def provision(employee, *, actor=None, correlation_id=None):
    """EMPLOYEE_CREATED plus a pending link, exactly once per employee: a
    second call while a link exists is a no-op (UAT-01, UAT-10)."""
    link, created = LmsIdentityLink.objects.get_or_create(employee=employee)
    if not created and link.status != LinkStatus.DEACTIVATED:
        return None
    if not created:
        # Rehire: reactivate the same learner instead of creating another.
        link.status = LinkStatus.LINKED if link.learner_id else LinkStatus.PENDING
        link.save(update_fields=["status", "updated_at"])
    employee.lms_link = link
    return enqueue(employee, EMPLOYEE_CREATED, actor=actor, correlation_id=correlation_id)


def events_for_change(employee, before: dict | None) -> list[str]:
    """Which outbound events an Employee save should raise. `before` is the
    tracked-field snapshot taken in pre_save (None for a new row)."""
    link = LmsIdentityLink.objects.filter(employee=employee).first()
    eligible = employee.status in PROVISIONED_STATUSES

    if link is None or link.status == LinkStatus.DEACTIVATED:
        # Not (or no longer) an LMS learner: only becoming eligible matters.
        if eligible and (
            before is None or before.get("status") not in PROVISIONED_STATUSES or link is None
        ):
            return [EMPLOYEE_CREATED]
        return []

    if before is None:
        return []
    changed = {f for f in TRACKED_FIELDS if before.get(f) != getattr(employee, f)}
    events = []
    if changed & set(STATUS_FIELDS):
        events.append(EMPLOYEE_STATUS_CHANGED)
    if changed & set(ROLE_FIELDS):
        events.append(ROLE_CHANGED)
    if changed & set(PROFILE_FIELDS):
        events.append(EMPLOYEE_UPDATED)
    return events


def tracked_values(employee) -> dict:
    return {f: getattr(employee, f) for f in TRACKED_FIELDS}
