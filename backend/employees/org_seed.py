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
from datetime import date

from django.db import transaction

from employees.models import (
    AuthorizedSignatory,
    Band,
    BusinessUnit,
    CostCenter,
    Department,
    Employee,
    Grade,
    LegalEntity,
    LegalEntityBankAccount,
    Location,
    PayGrade,
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


# --- Keka real org-structure values (SEED data, verified 2026-09-30) -----------
# Provenance: the user's 8 Keka screenshots (company registration, location,
# cost center, departments). Exact field values below; anything the
# screenshots did NOT show is left null/unchanged and reported by the caller.
#
# Idempotent: masters are matched BY NAME; real values overwrite blanks AND
# the legacy EXAMPLE placeholders this same function used to write
# (LEGACY_PLACEHOLDERS); any other (human) value is never overwritten.
# Safe to call on every boot after seed_derived_org_masters():
# load_real_directory wipes Location/CostCenter/Department rows, so this
# re-creates + re-fills them identically after the wipe. LegalEntity rows
# survive the wipe (migration-seeded), hence match-by-name with a
# primary/first fallback (reported by the caller when no exact-name match).
#
# Deliberately NOT seeded here: Business Units (the reference org has none),
# PayGrade/Band real values (never provided — EXAMPLE rows stay, flagged),
# AuthorizedSignatory/BankDetails field values (not provided — existing rows
# stay as-is, flagged), and — ROSTER IS SOURCE OF TRUTH (org-reconcile
# 2026-09-30) — the empty Keka duplicates "Sensiba-InfoSec Audit" cost
# center and assumed-spelling "SOX/ Design & Implementation" department
# (see DROPPED_* below): never created, deleted when empty.

REAL_LEGAL_ENTITY_NAME = "4AT Consulting LLP"
REAL_LEGAL_ENTITY = {
    "legal_name": "4AT Consulting LLP",
    "company_identification_number": "AAT-0747",
    "date_of_incorporation": date(2020, 7, 25),
    "type_of_business": LegalEntity.TYPE_LIMITED_LIABILITY,
    "sector": LegalEntity.SECTOR_PROFESSIONALS,
    "nature_of_business": "Chartered Accountants, Auditors, etc. (601)",
    "address_line1": "3rd Floor, D Block, iLabs Centre, Plot No.18, Silpa Gram Craft Village",
    "address_line2": "Madhapur",
    "city": "Hyderabad",
    "state": "Telangana",
    "zip_code": "500081",
    "country": "India",
    "currency": "INR",
    "financial_year": LegalEntity.FY_APR_MAR,
}

REAL_LOCATION_NAME = "Hyderabad"
REAL_LOCATION = {
    "address_line1": "3rd Floor, D Block, iLabs Centre, Plot No.18, Silpa Gram Craft Village",
    "address_line2": "Madhapur",
    "city": "Hyderabad",
    "state": "Telangana",
    "country": "India",
    "postal_code": "500081",
    "timezone": "Asia/Kolkata",
    "description": "Indian Office",
}

REAL_PARENT_DEPARTMENT = "Audit & Assurance"
# "Venture Captial Audit" keeps Keka's verbatim spelling. The roster's own
# row is "SOX/ Design & Implimentation" (kept, loader-created) — the
# assumed-spelling "SOX/ Design & Implementation" this seed used to write was
# an empty duplicate and is NOT created anymore (see DROPPED_* below).
# ROSTER IS SOURCE OF TRUTH: the "Audit & Assurance" parent itself comes
# from the roster (the loader builds it from the xlsx "Department" column),
# so it is left alone — the frontend rolls descendant employees up into it.
REAL_SUB_DEPARTMENTS = [
    "Venture Captial Audit",
    "InfoSec Audit",
]

# Empty Keka duplicates this seed used to create but must NOT anymore
# (roster is source of truth — see org-reconcile-spec). Leftover rows are
# deleted by seed_keka_org_details when empty; they are never recreated:
# - "Sensiba-InfoSec Audit" cost center (duplicates the roster-derived
#   "InfoSec Audit Cost Center", which holds the real 24 people);
# - "SOX/ Design & Implementation" department (assumed spelling; the
#   roster's own "SOX/ Design & Implimentation" row holds the real 8).
DROPPED_DUPLICATE_COST_CENTER = "Sensiba-InfoSec Audit"
DROPPED_DUPLICATE_DEPARTMENT = "SOX/ Design & Implementation"

# Legacy placeholders this function used to write before the real values
# were provided. A field holding one of these is overwritten with the real
# value; any other non-blank value is a human edit and is respected.
# Keep within LegalEntity.company_identification_number max_length=50.
EXAMPLE_CIN = "U72200TG2015PTC000000 (EXAMPLE — verify with CS)"
EXAMPLE_STREET = "Hyderabad office street address (EXAMPLE — verify with HR)"
LEGACY_PLACEHOLDERS = {EXAMPLE_CIN, EXAMPLE_STREET}

# (name, code, description, min_pay, mid_pay, max_pay) — EXAMPLE ranges.
EXAMPLE_PAY_GRADES = [
    ("E1 — Associate", "E1", "EXAMPLE entry-level grade", 300000, 400000, 500000),
    ("E2 — Senior Associate", "E2", "EXAMPLE experienced individual grade", 500000, 650000, 800000),
    ("M1 — Manager", "M1", "EXAMPLE first-line manager grade", 800000, 1000000, 1200000),
]

# (name, code, description, pay_grade_code or None) — EXAMPLE bands.
EXAMPLE_BANDS = [
    ("Individual Contributor", "IC", "EXAMPLE non-manager band", "E2"),
    ("People Manager", "MGR", "EXAMPLE manager band", "M1"),
]


@transaction.atomic
def seed_keka_org_details():
    """Persist the real Keka org-structure values as seed data.

    LegalEntity '4AT Consulting LLP' (or the primary/first entity when no
    exact-name match exists), Location 'Hyderabad', and the Audit &
    Assurance sub-departments that exist in the roster (re-linked under the
    roster-built parent when parent-less) receive the exact values from the
    verified Keka capture. Legacy EXAMPLE placeholders are replaced; human
    edits are respected.

    ROSTER IS SOURCE OF TRUTH: the empty Keka duplicates
    ("Sensiba-InfoSec Audit" cost center, assumed-spelling "SOX/ Design &
    Implementation" department) are never created here; leftover rows are
    deleted when empty (never when they hold people). Fresh boots cannot
    recreate them — the loader wipes these tables and this seed no longer
    writes these names.

    Returns the number of rows/fields *created or filled* per key
    (re-runs return zeros).
    """
    created = {
        "legal_entity_backfilled": 0,
        "location_backfilled": 0,
        "duplicate_cost_center_removed": 0,
        "duplicate_department_removed": 0,
        "sub_department": 0,
        "authorized_signatory": 0,
        "bank_account": 0,
        "pay_grade": 0,
        "band": 0,
    }
    entity = LegalEntity.objects.filter(name=REAL_LEGAL_ENTITY_NAME).first()
    if entity is None:
        entity = LegalEntity.objects.order_by("id").first()
    if entity is None:
        return created

    fills = {}
    for field, value in REAL_LEGAL_ENTITY.items():
        current = getattr(entity, field)
        if value is None:
            continue
        if isinstance(value, date):
            if current is None:
                fills[field] = value
        elif not current or current in LEGACY_PLACEHOLDERS:
            fills[field] = value
    if fills:
        for field, value in fills.items():
            setattr(entity, field, value)
        entity.save(update_fields=[*fills, "updated_at"])
        created["legal_entity_backfilled"] += 1

    location = Location.objects.filter(name=REAL_LOCATION_NAME).first()
    if location is not None:
        loc_fills = {
            field: value
            for field, value in REAL_LOCATION.items()
            if not getattr(location, field)
        }
        if loc_fills:
            for field, value in loc_fills.items():
                setattr(location, field, value)
            location.save(update_fields=[*loc_fills, "updated_at"])
            created["location_backfilled"] += 1

    # ROSTER IS SOURCE OF TRUTH — drop the empty Keka duplicates, never
    # recreate them. Deletion is empty-only (no employees; departments also
    # no children), so real data can never be dropped. The loader wipes
    # these tables on every boot, so normally there is nothing to delete.
    for cc in CostCenter.objects.filter(name=DROPPED_DUPLICATE_COST_CENTER):
        if cc.employees.count() == 0:
            cc.delete()
            created["duplicate_cost_center_removed"] += 1
    for dept in Department.objects.filter(name=DROPPED_DUPLICATE_DEPARTMENT):
        if dept.employees.count() == 0 and dept.children.count() == 0:
            dept.delete()
            created["duplicate_department_removed"] += 1

    parent = Department.objects.filter(name=REAL_PARENT_DEPARTMENT).first()
    if parent is not None:
        for name in REAL_SUB_DEPARTMENTS:
            child, was_created = Department.objects.get_or_create(
                name=name, defaults={"parent": parent}
            )
            created["sub_department"] += int(was_created)
            if not was_created and child.parent_id is None:
                child.parent = parent
                child.save(update_fields=["parent", "updated_at"])
    # Department head / email_alias / description were blank in Keka —
    # left unchanged, never fabricated.

    entities = list(LegalEntity.objects.order_by("id"))

    for entity in entities:

        if not entity.authorized_signatories.filter(is_active=True).exists():
            for name, designation, email in _example_signatories():
                _, was_created = AuthorizedSignatory.objects.get_or_create(
                    legal_entity=entity,
                    name=name,
                    defaults={
                        "designation": designation,
                        "email": email,
                    },
                )
                created["authorized_signatory"] += int(was_created)

        if not entity.bank_accounts.filter(is_active=True).exists():
            _, was_created = LegalEntityBankAccount.objects.get_or_create(
                legal_entity=entity,
                account_number="50100223456789 (EXAMPLE — verify)",
                defaults={
                    "bank_name": "HDFC Bank (EXAMPLE — verify)",
                    "ifsc_code": "HDFC0000000",
                    "branch": "Hyderabad (EXAMPLE — verify)",
                    "account_type": LegalEntityBankAccount.ACCOUNT_CURRENT,
                },
            )
            created["bank_account"] += int(was_created)

    for name, code, description, lo, mid, hi in EXAMPLE_PAY_GRADES:
        _, was_created = PayGrade.objects.get_or_create(
            name=name,
            defaults={
                "code": code,
                "description": description,
                "min_pay": lo,
                "mid_pay": mid,
                "max_pay": hi,
                "currency": "INR",
            },
        )
        created["pay_grade"] += int(was_created)

    grades_by_code = {g.code: g for g in PayGrade.objects.filter(code__in=["E1", "E2", "M1"])}
    for name, code, description, grade_code in EXAMPLE_BANDS:
        _, was_created = Band.objects.get_or_create(
            name=name,
            defaults={
                "code": code,
                "description": description,
                "pay_grade": grades_by_code.get(grade_code),
            },
        )
        created["band"] += int(was_created)

    return created


def _example_signatories():
    """(name, designation, email) drawn ONLY from real employee rows.

    The two busiest managers stand in as example signatories; when the
    directory is empty (e.g. a bare test DB) this returns [] and the caller
    seeds nothing rather than inventing people.
    """
    employees = list(
        Employee.objects.select_related("user").exclude(status=Employee.STATUS_EXITED)
    )
    if not employees:
        return []
    counts = _report_counts()
    ranked = sorted(
        employees, key=lambda e: (-counts.get(e.pk, 0), e.employee_code)
    )
    out = []
    for e in ranked[:2]:
        full = e.user.get_full_name().strip() or e.employee_code
        out.append((full, (e.designation.name if e.designation_id else ""), e.user.email))
    return out
