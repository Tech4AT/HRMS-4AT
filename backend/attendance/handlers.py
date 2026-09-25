"""The consumer side of the approvals engine (docs/LEAVE-ATTENDANCE-
INTEGRATION.md). WFH and Regularisation each raise a `Request` via
approvals.create_request() (views.py's create()); when a manager decides it
through the generic engine, `request_decided` fires and this receiver applies
the effect to our own row — this app never builds its own approve/reject
endpoint (PLAN.md Step 3/5)."""

from datetime import timedelta

from django.dispatch import receiver
from django.utils import timezone

from approvals.signals import request_decided

from .models import (
    AttendanceRecord,
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceRequestType,
    AttendanceSource,
    AttendanceStatus,
)

# approvals status -> our AttendanceRequest.status
_STATUS = {
    "approved": AttendanceRequestStatus.APPROVED,
    "rejected": AttendanceRequestStatus.REJECTED,
    "withdrawn": AttendanceRequestStatus.CANCELLED,
}

# These are the approvals engine's request_type strings (chosen in views.py's
# create(), matching docs/LEAVE-ATTENDANCE-INTEGRATION.md's example naming) —
# deliberately not the same spelling as AttendanceRequestType's local values
# ("wfh"/"regularisation"), since "attendance_regularization" is this app's
# own choice, not dictated by the engine. Comparing against the wrong set here
# would make this receiver silently ignore every regularisation decision.
_OUR_TYPES = {"wfh", "attendance_regularization"}


@receiver(request_decided)
def apply_attendance_decision(sender, request, actor, status, **kwargs):
    if request.request_type not in _OUR_TYPES:
        return  # not ours — every module's decisions come through this signal
    row_id = (request.payload or {}).get("attendance_request_id")
    if not row_id:
        return
    row = AttendanceRequest.objects.filter(pk=row_id).first()
    if row is None:
        return

    row.status = _STATUS.get(status, row.status)
    row.decided_at = timezone.now()
    row.save(update_fields=["status", "decided_at", "updated_at"])

    if row.status == AttendanceRequestStatus.APPROVED:
        _mark_days(row)


def _mark_days(row: AttendanceRequest) -> None:
    """Regularisation "marks one whole day Present — no clock times" (the
    frontend's own description); WFH marks the day Work From Home. Never
    overwrites a day that already has a real clock-in or an existing marked
    status — an approval shouldn't silently erase an actual check-in."""
    target_status = (
        AttendanceStatus.WORK_FROM_HOME
        if row.request_type == AttendanceRequestType.WFH
        else AttendanceStatus.PRESENT
    )
    source = (
        AttendanceSource.SELF
        if row.request_type == AttendanceRequestType.WFH
        else AttendanceSource.REGULARIZATION
    )
    day = row.start_date
    while day <= row.end_date:
        record, created = AttendanceRecord.objects.get_or_create(
            employee=row.employee,
            attendance_date=day,
            defaults={"status": target_status, "source": source},
        )
        if (
            not created
            and record.status == AttendanceStatus.NOT_MARKED
            and not record.clock_in_time
        ):
            record.status = target_status
            record.source = source
            record.save(update_fields=["status", "source", "updated_at"])
        day += timedelta(days=1)
