"""Derive the empty org masters from the real employee directory.

BusinessUnit, CostCenter, Team and Position start at zero rows on every
fresh load: ``load_real_directory`` wipes departments / job titles /
locations and rebuilds them from the HR xlsx, and these four tables are
never populated by it. This module derives realistic rows from the real
employees plus the masters that do survive the wipe (legal entities,
departments, locations, job titles, grades, levels, job families):

- one BusinessUnit per top-level department (excluding the loader's
  ``Unassigned`` junk bucket), linked to the first legal entity; every
  department points at its unit and every employee inherits their
  department's unit (so business-unit analytics has real data);
- one CostCenter per department that has people, linked to the first legal
  entity and owned by the department's busiest manager when there is one;
  departments and employees point at it;
- one Team per department that has people, led by the employee in that
  department with the most direct reports (a real manager — nobody is
  invented); the lead stays empty when nobody in the department has any
  reports;
- one Position per (job title, department) combo present among employees,
  linked to department / job title / level / grade / business unit; every
  employee in the combo holds it (``Employee.position``) and the incumbent
  of record is the lowest employee code in the combo; status is filled.

Idempotent: every row is get-or-create/update by deterministic name, and
employee/department links are only filled when empty — a human edit is
never overwritten. Re-running (every backend boot re-runs the loader)
produces identical rows. No fabricated names: every person referenced is a
real employee row, and every grouping comes from the real roster.
"""

from collections import Counter

from django.db import transaction

from employees.models import (
    BusinessUnit,
    CostCenter,
    Department,
    Employee,
    Grade,
    LegalEntity,
    Position,
    Team,
)

# Loader junk buckets — groupings, not real org units. Never a BusinessUnit.
JUNK_DEPARTMENT_NAMES = {"Unassigned", "Unspecified"}


def _report_counts():
    """employee pk -> number of direct reports (over the whole directory)."""
    return Counter(
        Employee.objects.exclude(manager_id=None).values_list("manager_id", flat=True)
    )


def _busiest_manager(employees, counts):
    """The employee with the most direct reports (ties: lowest code).

    Returns None when nobody in the group has any reports — the caller
    leaves the lead/head/owner empty rather than inventing one."""
    ranked = sorted(
        ((counts.get(e.pk, 0), e) for e in employees),
        key=lambda t: (-t[0], t[1].employee_code),
    )
    if not ranked or ranked[0][0] == 0:
        return None
    return ranked[0][1]


def _default_legal_entity():
    return LegalEntity.objects.order_by("id").first()


@transaction.atomic
def seed_derived_org_masters():
    """Derive BusinessUnit/CostCenter/Team/Position rows. See module docstring.

    Returns the number of rows *created* per table (re-runs create nothing).
    """
    created = {"business_unit": 0, "cost_center": 0, "team": 0, "position": 0}
    employees = list(
        Employee.objects.select_related("department", "designation").exclude(
            status=Employee.STATUS_EXITED
        )
    )
    if not employees:
        return created
    counts = _report_counts()
    entity = _default_legal_entity()

    departments = {e.department for e in employees if e.department_id}
    # The full department tree (not just departments with direct members —
    # a pure grouping parent has no direct employees but still owns the
    # BusinessUnit its children roll up into).
    all_depts = {d.pk: d for d in Department.objects.all()}

    def root(dept_id):
        seen = set()
        current = dept_id
        while True:
            row = all_depts.get(current)
            if row is None or row.parent_id is None or row.parent_id in seen:
                return current
            seen.add(current)
            current = row.parent_id

    # --- BusinessUnits: one per real top-level department -----------------
    bu_by_root_id = {}
    top_level = [
        d for d in all_depts.values()
        if d.parent_id is None and d.name not in JUNK_DEPARTMENT_NAMES
    ]
    for dept in sorted(top_level, key=lambda d: d.name):
        bu, was_created = BusinessUnit.objects.get_or_create(
            name=dept.name, defaults={"legal_entity": entity}
        )
        created["business_unit"] += int(was_created)
        if bu.legal_entity_id is None and entity is not None:
            bu.legal_entity = entity
            bu.save(update_fields=["legal_entity", "updated_at"])
        members = [e for e in employees if e.department_id and root(e.department_id) == dept.pk]
        head = _busiest_manager(members, counts)
        if head is not None and bu.head_id is None:
            bu.head = head
            bu.save(update_fields=["head", "updated_at"])
        bu_by_root_id[dept.pk] = bu

    # Every department (populated or grouping) points at its root's unit.
    for dept in all_depts.values():
        if dept.business_unit_id is not None:
            continue
        bu = bu_by_root_id.get(root(dept.pk))
        if bu is not None:
            Department.objects.filter(pk=dept.pk).update(business_unit=bu)

    for e in employees:
        if e.business_unit_id is None and e.department_id:
            bu = bu_by_root_id.get(root(e.department_id))
            if bu is not None:
                Employee.objects.filter(pk=e.pk).update(business_unit=bu)

    # --- CostCenters: one per department that has people ------------------
    for dept in sorted(departments, key=lambda d: d.name):
        members = [e for e in employees if e.department_id == dept.pk]
        if not members:
            continue
        cc, was_created = CostCenter.objects.get_or_create(
            name=f"{dept.name} Cost Center", defaults={"legal_entity": entity}
        )
        created["cost_center"] += int(was_created)
        if cc.legal_entity_id is None and entity is not None:
            cc.legal_entity = entity
            cc.save(update_fields=["legal_entity", "updated_at"])
        owner = _busiest_manager(members, counts)
        if owner is not None and cc.owner_id is None:
            cc.owner = owner
            cc.save(update_fields=["owner", "updated_at"])
        dept_row = Department.objects.get(pk=dept.pk)
        if dept_row.cost_center_id is None:
            dept_row.cost_center = cc
            dept_row.save(update_fields=["cost_center", "updated_at"])
        Employee.objects.filter(
            department_id=dept.pk, cost_center_id=None
        ).update(cost_center=cc)

    # --- Teams: one per department that has people ------------------------
    for dept in sorted(departments, key=lambda d: d.name):
        members = [e for e in employees if e.department_id == dept.pk]
        if not members:
            continue
        team, was_created = Team.objects.get_or_create(
            name=f"{dept.name} Team", defaults={"department_id": dept.pk}
        )
        created["team"] += int(was_created)
        if team.department_id is None:
            team.department_id = dept.pk
            team.save(update_fields=["department", "updated_at"])
        lead = _busiest_manager(members, counts)
        if lead is not None and team.lead_id is None:
            team.lead = lead
            team.save(update_fields=["lead", "updated_at"])

    # --- Positions: one per (job title, department) combo -----------------
    combos = {}
    for e in employees:
        if e.designation_id and e.department_id:
            combos.setdefault((e.designation_id, e.department_id), []).append(e)
    for (title_id, dept_id), holders in combos.items():
        title = holders[0].designation
        dept_row = Department.objects.get(pk=dept_id)
        grade = None
        if title.level_id is not None:
            grade = (
                Grade.objects.filter(level_id=title.level_id, is_active=True)
                .order_by("id")
                .first()
            )
        position, was_created = Position.objects.get_or_create(
            name=f"{title.name} — {dept_row.name}",
            department_id=dept_id,
            job_title_id=title_id,
            defaults={
                "level_id": title.level_id,
                "grade": grade,
                "business_unit_id": dept_row.business_unit_id,
                "status": Position.STATUS_FILLED,
            },
        )
        created["position"] += int(was_created)
        if position.level_id is None and title.level_id is not None:
            position.level_id = title.level_id
            position.save(update_fields=["level", "updated_at"])
        if position.grade_id is None and grade is not None:
            position.grade = grade
            position.save(update_fields=["grade", "updated_at"])
        if position.business_unit_id is None and dept_row.business_unit_id is not None:
            position.business_unit_id = dept_row.business_unit_id
            position.save(update_fields=["business_unit", "updated_at"])
        incumbent = min(holders, key=lambda e: e.employee_code)
        if position.incumbent_id is None:
            position.incumbent = incumbent
            position.status = Position.STATUS_FILLED
            position.save(update_fields=["incumbent", "status", "updated_at"])
        Employee.objects.filter(
            designation_id=title_id, department_id=dept_id, position_id=None
        ).update(position=position)

    return created
