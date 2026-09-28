"""Applying a due change to the employee row — shared by the
`apply_due_org_changes` management command (the only writer). Each change type
copies its payload ids onto the employee; a position change additionally moves
the seat's incumbent link so the seat and the person agree."""

from django.db import transaction

from audit.service import write_audit
from employees.models import Position
from employees.serializers import EmployeeWriteSerializer
from orgchanges.models import OrgChange
from orgchanges.serializers import APPLIABLE_FIELDS, validate_to_data


def apply_org_change(change, actor=None):
    """Apply one pending OrgChange; returns the employee. Raises ValueError
    if the row is not appliable, so the caller can leave it pending."""
    if change.status != OrgChange.STATUS_PENDING:
        raise ValueError(f"OrgChange {change.pk} is {change.status}, not pending.")
    employee = change.employee
    resolved = validate_to_data(change.change_type, change.to_data)

    if change.change_type == OrgChange.TYPE_MANAGER_CHANGE and "manager" in resolved:
        EmployeeWriteSerializer._reject_reporting_cycle(employee, resolved["manager"])

    with transaction.atomic():
        old_position = employee.position
        for field in resolved:
            setattr(employee, field, resolved[field])
        employee.save()
        _sync_position_seat(change, employee, old_position)
        change.status = OrgChange.STATUS_EFFECTIVE
        change.save(update_fields=["status", "updated_at"])
        write_audit(
            actor,
            f"OrgChange.{change.change_type}",
            "OrgChange",
            change.pk,
            {"employee": employee.pk, "to": change.to_data},
        )
    return employee


def _sync_position_seat(change, employee, old_position):
    """A position change moves the seat: the new seat names this employee its
    incumbent (and reads filled), the old seat is vacated if it still named
    them. Other change types leave the seats alone."""
    if change.change_type != OrgChange.TYPE_POSITION_CHANGE or "position_id" not in (
        change.to_data or {}
    ):
        return
    new_position = Position.objects.filter(pk=change.to_data["position_id"]).first()
    if new_position is not None:
        new_position.incumbent = employee
        if new_position.status == Position.STATUS_VACANT:
            new_position.status = Position.STATUS_FILLED
        new_position.save(update_fields=["incumbent", "status", "updated_at"])
    if old_position is not None and (new_position is None or old_position.pk != new_position.pk):
        old_position.refresh_from_db()
        if old_position.incumbent_id == employee.pk:
            old_position.incumbent = None
            if old_position.status == Position.STATUS_FILLED:
                old_position.status = Position.STATUS_VACANT
            old_position.save(update_fields=["incumbent", "status", "updated_at"])
