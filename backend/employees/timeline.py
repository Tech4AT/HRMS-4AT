"""The Employee 360 timeline: one person's career milestones, newest first.

Built from what the system already records, nothing is stored just for this:
the joining date, org changes that took effect (promotions, transfers, manager
and position changes), reports being added under this person, and their
resignation and exit. Sources are read-only here, so the timeline can never
disagree with the records it summarises.

`include_sensitive` adds the resignation lifecycle (submitted, accepted,
rejected, withdrawn), which only the person and HR should see. Joining, moves
and leaving are ordinary directory facts.
"""

from django.db.models import Q

from audit.models import AuditLog
from employees.models import (
    BusinessUnit,
    Department,
    Designation,
    Employee,
    Grade,
    Level,
    Location,
    Position,
    Resignation,
)

# Org-change payload key -> the table it points at.
_KEY_MODELS = {
    "designation_id": Designation,
    "level_id": Level,
    "grade_id": Grade,
    "department_id": Department,
    "business_unit_id": BusinessUnit,
    "location_id": Location,
    "position_id": Position,
    "manager_id": Employee,
}

_CHANGE_TITLES = {
    "promotion": "Promoted",
    "dept_transfer": "Moved to a new department",
    "location_transfer": "Moved to a new location",
    "position_change": "Position changed",
    "manager_change": "Reporting manager changed",
}


def _person_name(employee) -> str:
    user = employee.user
    return f"{user.first_name} {user.last_name}".strip() or employee.employee_code


class _Names:
    """Resolves the ids inside org-change payloads to display names, one query
    per table however many events there are."""

    def __init__(self, payloads):
        wanted: dict[str, set] = {}
        for payload in payloads:
            for key, value in (payload or {}).items():
                if key in _KEY_MODELS and value not in (None, ""):
                    wanted.setdefault(key, set()).add(str(value))
        self._names: dict[tuple[str, str], str] = {}
        for key, ids in wanted.items():
            model = _KEY_MODELS[key]
            if model is Employee:
                rows = Employee.objects.select_related("user").filter(pk__in=self._ints(ids))
                for row in rows:
                    self._names[(key, str(row.pk))] = _person_name(row)
            else:
                for row in model.objects.filter(pk__in=self._ints(ids)):
                    self._names[(key, str(row.pk))] = row.name

    @staticmethod
    def _ints(ids):
        return [int(i) for i in ids if str(i).isdigit()]

    def describe(self, payload) -> list[str]:
        out = []
        for key in _KEY_MODELS:
            value = (payload or {}).get(key)
            if value not in (None, ""):
                name = self._names.get((key, str(value)))
                if name:
                    out.append(name)
        return out


def _event(kind, title, when, *, detail=None, person=None, key=None):
    return {
        "id": key or kind,
        "kind": kind,
        "title": title,
        "date": when.isoformat() if when else None,
        "detail": detail,
        "person": person,
    }


def _org_change_events(employee):
    changes = list(employee.org_changes.filter(status="effective"))
    names = _Names([p for c in changes for p in (c.from_data, c.to_data)])
    events = []
    for change in changes:
        before = ", ".join(names.describe(change.from_data))
        after = ", ".join(names.describe(change.to_data))
        detail = f"{before} → {after}" if before and after else (after or None)
        events.append(
            _event(
                change.change_type,
                _CHANGE_TITLES.get(change.change_type, "Organisation change"),
                change.effective_date,
                detail=detail,
                key=f"orgchange-{change.pk}",
            )
        )
    return events


def _direct_report_events(employee):
    """Someone was placed under this person: via an effective manager change, or
    when the record was created/edited with them as manager (audit trail)."""
    me = str(employee.pk)
    org_change_model = employee.org_changes.model
    changes = list(
        org_change_model.objects.filter(
            change_type="manager_change",
            status="effective",
        )
        .filter(Q(to_data__manager_id=me) | Q(to_data__manager_id=employee.pk))
        .select_related("employee__user")
    )
    reports = [(c.employee, c.effective_date, f"orgchange-report-{c.pk}") for c in changes]

    audits = AuditLog.objects.filter(
        entity_type="Employee",
        action__in=["Employee.created", "Employee.updated"],
        diff__after__manager_id=me,
    )
    person_ids = set()
    audit_rows = []
    for row in audits:
        before_manager = (row.diff.get("before") or {}).get("manager_id")
        if row.action == "Employee.updated" and str(before_manager) == me:
            continue  # was already theirs; something else about the record changed
        if row.entity_id.isdigit():
            person_ids.add(int(row.entity_id))
            audit_rows.append(row)
    people = {
        e.pk: e for e in Employee.objects.select_related("user").filter(pk__in=person_ids)
    }
    for row in audit_rows:
        person = people.get(int(row.entity_id))
        if person is not None and person.pk != employee.pk:
            reports.append((person, row.created_at.date(), f"audit-report-{row.pk}"))

    seen, events = set(), []
    for person, when, key in reports:
        # The same hand-over can leave both an org change and an audit row.
        if (person.pk, when) in seen:
            continue
        seen.add((person.pk, when))
        events.append(
            _event(
                "direct_report_added",
                "Added direct report",
                when,
                person={"id": str(person.pk), "name": _person_name(person)},
                key=key,
            )
        )
    return events


def _resignation_events(employee):
    events = []
    for r in employee.resignations.all():
        events.append(
            _event(
                "resignation_submitted",
                "Resignation submitted",
                r.created_at.date(),
                detail=f"Requested last day: {r.requested_last_day.isoformat()}",
                key=f"resignation-{r.pk}-submitted",
            )
        )
        if r.status == Resignation.STATUS_ACCEPTED and r.decided_at:
            events.append(
                _event(
                    "resignation_accepted",
                    "Resignation accepted",
                    r.decided_at.date(),
                    detail=(
                        f"Last working day: {r.last_working_day.isoformat()}"
                        if r.last_working_day
                        else None
                    ),
                    key=f"resignation-{r.pk}-accepted",
                )
            )
        elif r.status == Resignation.STATUS_REJECTED and r.decided_at:
            events.append(
                _event(
                    "resignation_rejected",
                    "Resignation not accepted",
                    r.decided_at.date(),
                    key=f"resignation-{r.pk}-rejected",
                )
            )
        elif r.status == Resignation.STATUS_WITHDRAWN:
            events.append(
                _event(
                    "resignation_withdrawn",
                    "Resignation withdrawn",
                    r.updated_at.date(),
                    key=f"resignation-{r.pk}-withdrawn",
                )
            )
    return events


def build_timeline(employee, *, include_sensitive: bool) -> list[dict]:
    company = employee.legal_entity.name if employee.legal_entity_id else "the organisation"
    events = []

    joined = employee.date_of_joining or employee.joining_date
    if joined:
        events.append(_event("joined", f"Joined {company}", joined))

    events += _org_change_events(employee)
    events += _direct_report_events(employee)

    if employee.date_of_exit:
        events.append(_event("left", f"Left {company}", employee.date_of_exit))
    if include_sensitive:
        events += _resignation_events(employee)

    # Newest first; on the same day keep a stable, readable order.
    events.sort(key=lambda e: e["id"])
    events.sort(key=lambda e: e["date"] or "", reverse=True)
    return events
