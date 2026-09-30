"""Who is in someone's team: direct reports, indirect reports and peers.

Membership is organisation structure, which is already public directory data
(every signed-in user can see reporting lines in the org directory). What a
caller may see *about* those people is a separate question decided by the
attendance/leave permissions, not here.

Direct and indirect reports reuse the RBAC tier definitions in core.scope
(MANAGER = the person plus direct reports; TEAM = the person plus everyone
below them, computed by a cycle-safe recursive query), so "who is my team" here
can never drift from "who may I manage" there. Peers are the one relationship
the tiers have no name for: other people who report to the same manager.
"""

from core.enums import EmployeeStatus, ScopeTier
from core.scope import _employees_for_tier
from employees.models import Employee

DIRECT = "direct"
INDIRECT = "indirect"
PEERS = "peers"
GROUPS = (DIRECT, INDIRECT, PEERS)


def team_group(employee: Employee, group: str):
    """The current (not exited) people in `group` relative to `employee`, never
    including `employee` themselves. Raises ValueError for an unknown group."""
    if group not in GROUPS:
        raise ValueError(f"Unknown team group: {group!r}")

    if group == PEERS:
        if employee.manager_id is None:
            return Employee.objects.none()
        members = Employee.objects.filter(manager_id=employee.manager_id)
    else:
        direct_ids = set(
            _employees_for_tier(employee, ScopeTier.MANAGER).values_list("pk", flat=True)
        )
        if group == DIRECT:
            members = Employee.objects.filter(pk__in=direct_ids)
        else:
            team_ids = set(
                _employees_for_tier(employee, ScopeTier.TEAM).values_list("pk", flat=True)
            )
            members = Employee.objects.filter(pk__in=team_ids - direct_ids)

    return members.exclude(pk=employee.pk).exclude(status=EmployeeStatus.EXITED)
