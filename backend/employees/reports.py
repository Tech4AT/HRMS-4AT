"""Employee Reports (Org Dashboard > Employee Reports, Keka-style).

Three read endpoints plus saved-custom-report CRUD, all ``org.read``-gated
(``{success, data}`` snake_case envelope like the other org read lists):

- ``GET /api/v1/org/reports/catalog/`` — the category sidebar + report cards:
  every category with its reports (id, title, one-line description, whether
  it is wired to real data, and the honest-empty note when it is not).
- ``GET /api/v1/org/reports/run/?type=<report>`` — rows for one report, with
  optional filters (``business_unit``, ``department``, ``location``,
  ``cost_center``, ``legal_entity``, ``band``, ``search``) and, for
  employee-sourced reports, an optional ``columns=`` key list. Answers
  ``{type, title, columns: [{key, label}], rows: [...], total,
  unavailable}``. ``unavailable`` is set (with rows empty) when the source
  genuinely does not exist on this branch — never fabricated rows.
- ``GET /api/v1/org/reports/export/?type=<report>&...`` — the same payload
  rendered as CSV (``<type>-YYYYMMDD.csv``).
- ``CustomReport`` CRUD at ``org/reports/custom/`` (owner-scoped) plus
  ``GET /api/v1/org/reports/run/?custom=<id>`` which runs a saved report.

Data honesty rules: every row comes from a real table on this branch.
Columns with no source (dotted-line manager, profile pictures, work
experience, weekly-off/penalisation/login-failures detail, join dates while
the roster carries none) render blank or as an ``unavailable`` note, never
made-up values. Personal columns (personal email, phone, dob, gender) are
blanked row-by-row unless the caller holds ``employees.personal.read``.

Band: a parallel worker is adding Pay Grade/Band models plus Legal Entity
fields. ``_band_name()`` reads a dedicated ``band`` FK when one exists on
the Employee model, falls back to the grade name, and is blank otherwise —
so the Band column/filter starts working the moment either source has data,
with zero code change.
"""

import csv

from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import HasPermissionCode
from core.scope import user_has_permission
from employees.models import CustomReport, Employee

# --------------------------------------------------------------------------
# Field registry: every column key the engine (and the custom-report wizard)
# can render, grouped the way the wizard's step 1 shows them.
# --------------------------------------------------------------------------

GROUP_BASIC = "Employee Basic Info"
GROUP_PERSONAL = "Personal Info"
GROUP_JOB = "Job Info"
GROUP_CONTACT = "Contact Info"
GROUP_IDENTITY = "Identity Info"

PERSONAL_FIELDS = frozenset({"personal_email", "phone", "dob", "gender"})

FIELDS = {
    # basic
    "employee_number": ("Employee Number", GROUP_BASIC),
    "full_name": ("Full Name", GROUP_BASIC),
    "first_name": ("First Name", GROUP_BASIC),
    "last_name": ("Last Name", GROUP_BASIC),
    "status": ("Status", GROUP_BASIC),
    "employment_type": ("Employment Type", GROUP_BASIC),
    # personal (gated — blanked without employees.personal.read)
    "personal_email": ("Personal Email", GROUP_PERSONAL),
    "phone": ("Phone", GROUP_PERSONAL),
    "dob": ("Date of Birth", GROUP_PERSONAL),
    "gender": ("Gender", GROUP_PERSONAL),
    # job
    "date_of_joining": ("Date of Joining", GROUP_JOB),
    "job_title": ("Job Title", GROUP_JOB),
    "business_unit": ("Business Unit", GROUP_JOB),
    "department": ("Department", GROUP_JOB),
    "sub_department": ("Sub Department", GROUP_JOB),
    "location": ("Location", GROUP_JOB),
    "cost_center": ("Cost Center", GROUP_JOB),
    "legal_entity": ("Legal Entity", GROUP_JOB),
    "band": ("Band", GROUP_JOB),
    "reporting_to": ("Reporting To", GROUP_JOB),
    "dotted_line_manager": ("Dotted Line Manager", GROUP_JOB),
    "position": ("Position", GROUP_JOB),
    "level": ("Level", GROUP_JOB),
    "grade": ("Grade", GROUP_JOB),
    "date_of_exit": ("Date of Exit", GROUP_JOB),
    # contact
    "work_email": ("Email", GROUP_CONTACT),
    # identity (masked numbers + verification state of the latest doc)
    "aadhaar_number": ("Aadhaar Number", GROUP_IDENTITY),
    "aadhaar_status": ("Aadhaar Verification", GROUP_IDENTITY),
    "pan_number": ("PAN Number", GROUP_IDENTITY),
    "pan_status": ("PAN Verification", GROUP_IDENTITY),
    "passport_number": ("Passport Number", GROUP_IDENTITY),
    "passport_status": ("Passport Verification", GROUP_IDENTITY),
    "id_documents": ("Identity Documents", GROUP_IDENTITY),
}

GROUP_ORDER = (GROUP_BASIC, GROUP_PERSONAL, GROUP_JOB, GROUP_CONTACT, GROUP_IDENTITY)

FILTER_KEYS = (
    "business_unit",
    "department",
    "location",
    "cost_center",
    "legal_entity",
    "band",
    "search",
)


def _field_groups():
    """``[{name, fields: [{key, label}], count}]`` for the wizard's step 1."""
    groups = []
    for group in GROUP_ORDER:
        fields = [
            {"key": key, "label": label}
            for key, (label, owner) in FIELDS.items()
            if owner == group
        ]
        groups.append({"name": group, "fields": fields, "count": len(fields)})
    return groups


# --------------------------------------------------------------------------
# Row helpers
# --------------------------------------------------------------------------

_BAND_FIELD_CACHED = None


def _employee_has_band_field():
    """Whether a dedicated band FK exists on Employee yet (parallel worker)."""
    global _BAND_FIELD_CACHED
    if _BAND_FIELD_CACHED is None:
        _BAND_FIELD_CACHED = any(
            f.name == "band" for f in Employee._meta.get_fields()
        )
    return _BAND_FIELD_CACHED


def _band_name(emp):
    if _employee_has_band_field():
        band = getattr(emp, "band", None)
        name = getattr(band, "name", "") if band is not None else ""
        if name:
            return name
    grade = getattr(emp, "grade", None)
    return grade.name if grade is not None else ""


def _person_name(emp):
    """Best display name: mirrored names, else the linked user's name."""
    full = (emp.full_name or "").strip()
    if full:
        return full
    user = getattr(emp, "user", None)
    if user is not None:
        full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
        if full:
            return full
    return emp.employee_code


def _work_email(emp):
    if getattr(emp, "work_email", None):
        return emp.work_email
    user = getattr(emp, "user", None)
    return getattr(user, "email", "") if user is not None else ""


def _dept_pair(emp):
    """(department, sub_department): a child dept splits across both."""
    dept = getattr(emp, "department", None)
    if dept is None:
        return "", ""
    parent = getattr(dept, "parent", None)
    if parent is not None:
        return parent.name, dept.name
    return dept.name, ""


def _mask(value):
    if not value:
        return ""
    return value if len(value) <= 4 else "\u2022" * (len(value) - 4) + value[-4:]


def _identity_map(emp):
    """Latest doc per type for the Identity Info columns."""
    docs = list(getattr(emp, "identity_documents", []).all())
    latest = {}
    for doc in docs:
        prev = latest.get(doc.document_type)
        if prev is None or doc.created_at > prev.created_at:
            latest[doc.document_type] = doc
    return latest, len(docs)


def _employee_row(emp, columns, *, can_see_personal):
    dept_name, sub_dept = _dept_pair(emp)
    designation = getattr(emp, "designation", None)
    bu = getattr(emp, "business_unit", None)
    loc = getattr(emp, "location", None)
    cc = getattr(emp, "cost_center", None)
    le = getattr(emp, "legal_entity", None)
    position = getattr(emp, "position", None)
    level = getattr(emp, "level", None)
    grade = getattr(emp, "grade", None)
    manager = getattr(emp, "manager", None)
    latest, doc_count = _identity_map(emp)

    def id_col(doc_type, number=True):
        doc = latest.get(doc_type)
        if doc is None:
            return ""
        return _mask(doc.document_number) if number else doc.get_verification_status_display()

    verified = sum(1 for d in latest.values() if d.verification_status == "verified")
    values = {
        "employee_number": emp.employee_code,
        "full_name": _person_name(emp),
        "first_name": getattr(emp, "first_name", "") or "",
        "last_name": getattr(emp, "last_name", "") or "",
        "status": emp.status,
        "employment_type": emp.employment_type,
        "personal_email": emp.personal_email if can_see_personal else "",
        "phone": emp.phone if can_see_personal else "",
        "dob": emp.dob.isoformat() if emp.dob and can_see_personal else "",
        "gender": emp.gender if can_see_personal else "",
        "date_of_joining": emp.date_of_joining.isoformat() if emp.date_of_joining else "",
        "job_title": designation.name if designation else "",
        "business_unit": bu.name if bu else "",
        "department": dept_name,
        "sub_department": sub_dept,
        "location": loc.name if loc else "",
        "cost_center": cc.name if cc else "",
        "legal_entity": le.name if le else "",
        "band": _band_name(emp),
        "reporting_to": _person_name(manager) if manager else "",
        # No dotted-line/second-manager FK exists on this branch — honest blank.
        "dotted_line_manager": "",
        "position": position.name if position else "",
        "level": level.name if level else "",
        "grade": grade.name if grade else "",
        "date_of_exit": emp.date_of_exit.isoformat() if emp.date_of_exit else "",
        "work_email": _work_email(emp),
        "aadhaar_number": id_col("aadhaar"),
        "aadhaar_status": id_col("aadhaar", number=False),
        "pan_number": id_col("pan"),
        "pan_status": id_col("pan", number=False),
        "passport_number": id_col("passport"),
        "passport_status": id_col("passport", number=False),
        "id_documents": f"{verified}/{doc_count} verified" if doc_count else "",
    }
    return {key: values.get(key, "") for key in columns}


def _filtered_employees(params):
    """Employee queryset with the report filter bar applied.

    ``department`` matches the department itself or its parent (so filtering
    a top-level department also catches its sub-departments); ``band``
    matches the resolved band name; ``search`` covers code, name and email.
    Exited employees are included — reports (unlike the live chart) show the
    whole roster; the status column tells them apart.
    """
    queryset = (
        Employee.objects.select_related(
            "user",
            "manager",
            "manager__user",
            "department",
            "department__parent",
            "designation",
            "location",
            "legal_entity",
            "business_unit",
            "cost_center",
            "position",
            "level",
            "grade",
        )
        .prefetch_related("identity_documents")
        .order_by("employee_code")
    )
    for field in ("business_unit", "location", "cost_center", "legal_entity"):
        value = params.get(field)
        if value:
            queryset = queryset.filter(**{f"{field}__in": value.split(",")})
    department = params.get("department")
    if department:
        ids = department.split(",")
        queryset = queryset.filter(
            Q(department__in=ids) | Q(department__parent__in=ids)
        )
    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(employee_code__icontains=search)
            | Q(first_name__icontains=search)
            | Q(last_name__icontains=search)
            | Q(work_email__icontains=search)
            | Q(user__first_name__icontains=search)
            | Q(user__last_name__icontains=search)
            | Q(user__email__icontains=search)
        )
    rows = list(queryset)
    band = (params.get("band") or "").strip().lower()
    if band:
        wanted = {b.strip().lower() for b in band.split(",") if b.strip()}
        rows = [e for e in rows if _band_name(e).lower() in wanted]
    return rows


# --------------------------------------------------------------------------
# Report registry
# --------------------------------------------------------------------------

ALL_EMPLOYEES_COLUMNS = [
    "employee_number",
    "full_name",
    "work_email",
    "date_of_joining",
    "job_title",
    "business_unit",
    "department",
    "sub_department",
    "location",
    "cost_center",
    "legal_entity",
    "band",
    "reporting_to",
    "dotted_line_manager",
]

MASTER_DETAILS_COLUMNS = [
    "employee_number",
    "full_name",
    "work_email",
    "personal_email",
    "phone",
    "dob",
    "gender",
    "date_of_joining",
    "job_title",
    "department",
    "sub_department",
    "business_unit",
    "location",
    "cost_center",
    "legal_entity",
    "band",
    "reporting_to",
    "aadhaar_number",
    "aadhaar_status",
    "pan_number",
    "pan_status",
]

JOB_DETAILS_COLUMNS = [
    "employee_number",
    "full_name",
    "work_email",
    "date_of_joining",
    "job_title",
    "department",
    "sub_department",
    "business_unit",
    "location",
    "cost_center",
    "legal_entity",
    "band",
    "level",
    "grade",
    "position",
    "reporting_to",
    "employment_type",
    "status",
]

REPORTS = {
    # -- Employee Info --
    "all_employees": {
        "title": "All Employees",
        "description": "Every employee with job, org and reporting columns.",
        "category": "employee_info",
        "columns": ALL_EMPLOYEES_COLUMNS,
        "source": "employees",
    },
    "master_details": {
        "title": "Employee Master Details",
        "description": "Basic, personal, job, contact and identity columns per employee.",
        "category": "employee_info",
        "columns": MASTER_DETAILS_COLUMNS,
        "source": "employees",
    },
    "job_details": {
        "title": "Employee Job Details",
        "description": "Job titles, org placement, band, level, grade and position.",
        "category": "employee_info",
        "columns": JOB_DETAILS_COLUMNS,
        "source": "employees",
    },
    "roles": {
        "title": "Employee Roles",
        "description": "Which access role each employee holds.",
        "category": "employee_info",
        "columns": ["employee_number", "full_name", "work_email", "roles", "status"],
        "source": "roles",
    },
    "without_manager": {
        "title": "Employee Without Reporting Manager",
        "description": "Employees with no reporting manager assigned.",
        "category": "employee_info",
        "columns": ALL_EMPLOYEES_COLUMNS,
        "source": "without_manager",
    },
    "reporting_managers": {
        "title": "Reporting Managers Report",
        "description": "Every manager with direct-report and team sizes.",
        "category": "employee_info",
        "columns": [
            "employee_number",
            "full_name",
            "work_email",
            "department",
            "direct_reports",
            "team_size",
        ],
        "source": "reporting_managers",
    },
    "work_experience": {
        "title": "Employee Work Experience Report",
        "description": "Prior experience per employee.",
        "category": "employee_info",
        "columns": ["employee_number", "full_name", "organisation", "years"],
        "source": "empty",
        "unavailable": "Work experience is not tracked on this branch, so there is nothing to show.",
    },
    "documents": {
        "title": "Employee Documents Report",
        "description": "Files attached to employees, with upload and expiry detail.",
        "category": "employee_info",
        "columns": [
            "document_name",
            "category",
            "employee_number",
            "employee_name",
            "uploaded_by",
            "uploaded_on",
            "expiry_date",
        ],
        "source": "documents",
    },
    "profile_picture": {
        "title": "Employee Profile Picture Status Report",
        "description": "Who has a profile picture and who does not.",
        "category": "employee_info",
        "columns": ["employee_number", "full_name", "picture_status"],
        "source": "empty",
        "unavailable": "Profile pictures are not stored on this branch, so status cannot be computed.",
    },
    # -- Employee policies & Others --
    "company_policies": {
        "title": "Company Policies",
        "description": "Published policies with acknowledgment counts.",
        "category": "policies_others",
        "columns": ["title", "requires_ack", "acks", "active", "created"],
        "source": "policies",
    },
    "custom_fields": {
        "title": "Custom Fields",
        "description": "Employee custom attributes.",
        "category": "policies_others",
        "columns": ["employee_number", "full_name", "field", "value"],
        "source": "empty",
        "unavailable": "No custom-field storage exists on this branch.",
    },
    # -- Employee Demography --
    "headcount_department": {
        "title": "Headcount by Department",
        "description": "Live headcount per department.",
        "category": "demography",
        "columns": ["name", "headcount"],
        "source": "headcount_department",
    },
    "headcount_location": {
        "title": "Headcount by Location",
        "description": "Live headcount per location.",
        "category": "demography",
        "columns": ["name", "headcount"],
        "source": "headcount_location",
    },
    "gender_breakdown": {
        "title": "Gender Breakdown",
        "description": "Headcount by gender.",
        "category": "demography",
        "columns": ["name", "headcount"],
        "source": "gender",
    },
    "age_breakdown": {
        "title": "Age Breakdown",
        "description": "Headcount by age band.",
        "category": "demography",
        "columns": ["name", "headcount"],
        "source": "empty",
        "unavailable": "Dates of birth are not tracked, so no age breakdown is available.",
    },
    "tenure_breakdown": {
        "title": "Tenure Breakdown",
        "description": "Headcount by years of service.",
        "category": "demography",
        "columns": ["name", "headcount"],
        "source": "tenure",
    },
    # -- Invites & Registrations --
    "pending_invites": {
        "title": "Pending Invites",
        "description": "Set-password invitations still awaiting acceptance.",
        "category": "invites",
        "columns": ["email", "employee", "issued", "expires", "status"],
        "source": "invites",
    },
    "registration_status": {
        "title": "Registration Status",
        "description": "Who has completed sign-up and who is still pending.",
        "category": "invites",
        "columns": ["email", "name", "status", "last_login"],
        "source": "registration",
    },
    # -- New Joins & Exits --
    "new_joiners": {
        "title": "New Joiners",
        "description": "Recent and upcoming joiners by joining date.",
        "category": "joins_exits",
        "columns": ALL_EMPLOYEES_COLUMNS,
        "source": "new_joiners",
    },
    "exits": {
        "title": "Exits",
        "description": "Exited employees and open resignations.",
        "category": "joins_exits",
        "columns": [
            "employee_number",
            "full_name",
            "work_email",
            "department",
            "last_day",
            "reason",
            "resignation_status",
        ],
        "source": "exits",
    },
    # -- Logins --
    "login_activity": {
        "title": "Login Activity",
        "description": "Sign-ins and failed attempts across the organisation.",
        "category": "logins",
        "columns": ["when", "user", "action"],
        "source": "logins",
    },
    # -- Employee Aggregates --
    "headcount_summary": {
        "title": "Headcount Summary",
        "description": "Totals by department, location, unit, type and status.",
        "category": "aggregates",
        "columns": ["dimension", "name", "headcount"],
        "source": "headcount_summary",
    },
    "vacancy_summary": {
        "title": "Vacancy Summary",
        "description": "Open and hiring positions by department.",
        "category": "aggregates",
        "columns": ["position", "department", "job_title", "status", "incumbent"],
        "source": "vacancy",
    },
    "team_summary": {
        "title": "Team Summary",
        "description": "Team rosters with leads and department headcounts.",
        "category": "aggregates",
        "columns": ["team", "department", "lead", "department_headcount"],
        "source": "teams",
    },
    # -- Scheduled reports --
    "scheduled_reports": {
        "title": "Scheduled Reports",
        "description": "Reports on a recurring email schedule.",
        "category": "scheduled",
        "columns": ["name", "base", "schedule", "owner"],
        "source": "empty",
        "unavailable": "Report scheduling is not enabled yet — use the Schedule button on any report to note interest.",
    },
}

CATEGORIES = [
    {"id": "home", "label": "Reports Home"},
    {"id": "employee_info", "label": "Employee Info"},
    {"id": "policies_others", "label": "Employee policies & Others"},
    {"id": "demography", "label": "Employee Demography"},
    {"id": "invites", "label": "Invites & Registrations"},
    {"id": "joins_exits", "label": "New Joins & Exits"},
    {"id": "logins", "label": "Logins"},
    {"id": "aggregates", "label": "Employee Aggregates"},
    {"id": "scheduled", "label": "Scheduled reports"},
]


def _column_meta(keys):
    """``[{key, label}]`` — registry labels for employee fields, pretty
    fallback for computed report-only columns."""
    meta = []
    for key in keys:
        label = FIELDS[key][0] if key in FIELDS else " ".join(
            w.capitalize() for w in key.split("_")
        )
        meta.append({"key": key, "label": label})
    return meta


# --------------------------------------------------------------------------
# Source builders — each returns (rows, unavailable|None)
# --------------------------------------------------------------------------

def _employee_source(params, columns, user):
    can_see_personal = user_has_permission(user, "employees.personal.read")
    rows = _filtered_employees(params)
    return [_employee_row(e, columns, can_see_personal=can_see_personal) for e in rows], None


def _roles_source(params, user):
    from accounts.models import Role  # noqa: PLC0415 — avoid hard app coupling

    employees = _filtered_employees(params)
    computed_employee_role = None
    try:
        computed_employee_role = Role.objects.get(name="Employee")
    except Role.DoesNotExist:
        computed_employee_role = None
    rows = []
    for emp in employees:
        roles = list(emp.user.roles.filter(is_active=True)) if hasattr(emp, "user") else []
        names = sorted(r.name for r in roles)
        if not names and emp.status == Employee.STATUS_ACTIVE and computed_employee_role:
            # Membership in the Employee base role is computed (every active
            # employee holds it), never persisted — same rule as the roles UI.
            names = [computed_employee_role.name]
        rows.append(
            {
                "employee_number": emp.employee_code,
                "full_name": _person_name(emp),
                "work_email": _work_email(emp),
                "roles": ", ".join(names),
                "status": emp.status,
            }
        )
    return rows, None


def _managers_source(params, user):
    employees = _filtered_employees(params)
    by_id = {e.id: e for e in employees}
    children = {}
    for e in employees:
        if e.manager_id is not None:
            children.setdefault(e.manager_id, []).append(e.id)

    def subtree_size(manager_id):
        total = 0
        for child_id in children.get(manager_id, []):
            total += 1 + subtree_size(child_id)
        return total

    rows = []
    for manager_id, direct in children.items():
        manager = by_id.get(manager_id)
        if manager is None:
            continue
        dept = getattr(manager, "department", None)
        rows.append(
            {
                "employee_number": manager.employee_code,
                "full_name": _person_name(manager),
                "work_email": _work_email(manager),
                "department": dept.name if dept else "",
                "direct_reports": len(direct),
                "team_size": subtree_size(manager_id),
            }
        )
    rows.sort(key=lambda r: r["team_size"], reverse=True)
    return rows, None


def _documents_source(params, user):
    from documents.models import Document  # noqa: PLC0415

    queryset = Document.objects.select_related("employee", "uploaded_by").order_by(
        "-uploaded_at"
    )
    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(original_name__icontains=search)
            | Q(entity_type__icontains=search)
            | Q(employee__employee_code__icontains=search)
        )
    rows = []
    for doc in queryset:
        emp = getattr(doc, "employee", None)
        if emp is None and str(doc.entity_id).isdigit():
            try:
                emp = Employee.objects.select_related("user").get(pk=int(doc.entity_id))
            except Employee.DoesNotExist:
                emp = None
        uploader = getattr(doc, "uploaded_by", None)
        rows.append(
            {
                "document_name": doc.original_name,
                "category": doc.entity_type,
                "employee_number": emp.employee_code if emp else "",
                "employee_name": _person_name(emp) if emp else "",
                "uploaded_by": uploader.get_username() if uploader else "",
                "uploaded_on": doc.uploaded_at.date().isoformat(),
                "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else "",
            }
        )
    if not rows:
        return [], "No documents are stored yet."
    return rows, None


def _bucket_source(dimension, params):
    from employees.analytics_views import (  # noqa: PLC0415 — reuse chart logic
        _base_queryset,
        _dimension_payload,
    )

    payload = _dimension_payload(_base_queryset(params), dimension)
    if payload.get("withheld"):
        return [], payload.get("detail", "No source data.")
    return [
        {"name": b["name"], "headcount": b["headcount"]}
        for b in payload.get("buckets", [])
    ], None


def _gender_source(params, user):
    employees = _filtered_employees(params)
    counts = {}
    for emp in employees:
        if emp.gender:
            counts[emp.gender] = counts.get(emp.gender, 0) + 1
    if not counts:
        return [], "The roster carries no gender data, so no gender breakdown is available."
    can_see_personal = user_has_permission(user, "employees.personal.read")
    if not can_see_personal:
        return [], "Gender breakdown needs the personal-details permission."
    return [
        {"name": name, "headcount": n}
        for name, n in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    ], None


def _tenure_source(params, user):
    employees = _filtered_employees(params)
    dated = [e for e in employees if e.date_of_joining]
    if not dated:
        return [], "Join dates are not tracked, so no tenure breakdown is available."
    today = timezone.now().date()
    buckets = {"< 1 year": 0, "1–3 years": 0, "3–5 years": 0, "5+ years": 0}
    for emp in dated:
        years = (today - emp.date_of_joining).days / 365.25
        if years < 1:
            buckets["< 1 year"] += 1
        elif years < 3:
            buckets["1–3 years"] += 1
        elif years < 5:
            buckets["3–5 years"] += 1
        else:
            buckets["5+ years"] += 1
    return [
        {"name": name, "headcount": n} for name, n in buckets.items() if n
    ], None


def _invites_source(params, user):
    from accounts.models import PasswordSetupToken  # noqa: PLC0415

    queryset = PasswordSetupToken.objects.select_related(
        "user", "user__employee"
    ).order_by("-created_at")
    search = (params.get("search") or "").strip().lower()
    rows = []
    for token in queryset:
        email = token.user.email
        if search and search not in email.lower():
            continue
        emp = getattr(token.user, "employee", None)
        if token.used_at is not None:
            status = "accepted"
        elif not token.is_valid:
            status = "expired"
        else:
            status = "pending"
        rows.append(
            {
                "email": email,
                "employee": emp.employee_code if emp else "",
                "issued": token.created_at.date().isoformat(),
                "expires": token.expires_at.date().isoformat(),
                "status": status,
            }
        )
    if not rows:
        return [], "No invitations have been issued."
    return rows, None


def _registration_source(params, user):
    from accounts.models import User  # noqa: PLC0415

    queryset = User.objects.select_related("employee").order_by("email")
    search = (params.get("search") or "").strip().lower()
    rows = []
    for account in queryset:
        if search and search not in (account.email or "").lower():
            continue
        if account.last_login is not None:
            status = "registered"
        elif account.must_change_password:
            status = "pending"
        else:
            status = "invited"
        first = getattr(account, "first_name", "") or ""
        last = getattr(account, "last_name", "") or ""
        rows.append(
            {
                "email": account.email,
                "name": f"{first} {last}".strip() or account.get_username(),
                "status": status,
                "last_login": account.last_login.date().isoformat()
                if account.last_login
                else "",
            }
        )
    return rows, None


def _new_joiners_source(params, user, *, columns):
    employees = _filtered_employees(params)
    dated = [e for e in employees if e.date_of_joining]
    if not dated:
        return [], "Join dates are not tracked on this branch, so new joiners cannot be listed."
    can_see_personal = user_has_permission(user, "employees.personal.read")
    dated.sort(key=lambda e: e.date_of_joining, reverse=True)
    return [
        _employee_row(e, columns, can_see_personal=can_see_personal) for e in dated
    ], None


def _exits_source(params, user):
    from employees.models import Resignation  # noqa: PLC0415

    open_res = {}
    for res in Resignation.objects.select_related("employee").filter(
        status__in=Resignation.OPEN_STATUSES
    ):
        open_res[res.employee_id] = res
    employees = _filtered_employees(params)
    rows = []
    for emp in employees:
        res = open_res.get(emp.id)
        if emp.status != Employee.STATUS_EXITED and res is None:
            continue
        dept = getattr(emp, "department", None)
        rows.append(
            {
                "employee_number": emp.employee_code,
                "full_name": _person_name(emp),
                "work_email": _work_email(emp),
                "department": dept.name if dept else "",
                "last_day": (
                    (res.requested_last_day.isoformat() if res.requested_last_day else "")
                    if res
                    else (emp.date_of_exit.isoformat() if emp.date_of_exit else "")
                ),
                "reason": res.reason if res else emp.exit_reason,
                "resignation_status": res.status if res else (
                    "exited" if emp.status == Employee.STATUS_EXITED else ""
                ),
            }
        )
    if not rows:
        return [], "No exits or open resignations."
    return rows, None


def _logins_source(params, user):
    from accounts.models import FailedLoginAttempt  # noqa: PLC0415
    from audit.models import AuditLog  # noqa: PLC0415

    logs = (
        AuditLog.objects.select_related("actor")
        .filter(action__startswith="auth.login")
        .order_by("-created_at")[:500]
    )
    search = (params.get("search") or "").strip().lower()
    rows = [
        {
            "when": log.created_at.isoformat(),
            "user": log.actor.get_username() if log.actor else "",
            "action": log.action,
        }
        for log in logs
        if not search
        or search in (log.actor.get_username().lower() if log.actor else "")
        or search in log.action
    ]
    for attempt in FailedLoginAttempt.objects.select_related("user").order_by(
        "-created_at"
    )[:200]:
        if search and search not in attempt.user.get_username().lower():
            continue
        rows.append(
            {
                "when": attempt.created_at.isoformat(),
                "user": attempt.user.get_username(),
                "action": "auth.login_failed",
            }
        )
    rows.sort(key=lambda r: r["when"], reverse=True)
    if not rows:
        return [], "No login events recorded yet."
    return rows, None


def _headcount_summary_source(params, user):
    from employees.analytics_views import (  # noqa: PLC0415
        _base_queryset,
        _buckets,
        _value_buckets,
    )

    queryset = _base_queryset(params)
    rows = []
    for dimension, label in (
        ("department", "Department"),
        ("location", "Location"),
        ("business_unit", "Business Unit"),
        ("employment_type", "Employment Type"),
        ("status", "Status"),
    ):
        if dimension in ("employment_type", "status"):
            buckets = _value_buckets(
                queryset
                if dimension != "status"
                else _base_queryset(params, for_status_breakdown=True),
                dimension,
            )
        else:
            buckets = _buckets(queryset, dimension)
        for bucket in buckets:
            rows.append(
                {
                    "dimension": label,
                    "name": bucket["name"],
                    "headcount": bucket["headcount"],
                }
            )
    return rows, None


def _vacancy_source(params, user):
    from employees.models import Position  # noqa: PLC0415

    queryset = (
        Position.objects.select_related(
            "department", "job_title", "incumbent", "incumbent__user"
        )
        .filter(is_active=True)
        .exclude(status=Position.STATUS_FILLED)
        .order_by("name")
    )
    department = params.get("department")
    if department:
        ids = department.split(",")
        queryset = queryset.filter(
            Q(department__in=ids) | Q(department__parent__in=ids)
        )
    rows = []
    for pos in queryset:
        incumbent = getattr(pos, "incumbent", None)
        rows.append(
            {
                "position": pos.name or f"Position {pos.pk}",
                "department": pos.department.name if pos.department else "",
                "job_title": pos.job_title.name if pos.job_title else "",
                "status": pos.status,
                "incumbent": _person_name(incumbent) if incumbent else "",
            }
        )
    if not rows:
        return [], "No open or hiring positions right now."
    return rows, None


def _teams_source(params, user):
    from employees.models import Team  # noqa: PLC0415

    teams = Team.objects.select_related("department", "lead", "lead__user").filter(
        is_active=True
    ).order_by("name")
    dept_counts = dict(
        Employee.objects.exclude(status=Employee.STATUS_EXITED)
        .values("department")
        .annotate(n=Count("id"))
        .values_list("department", "n")
    )
    rows = []
    for team in teams:
        lead = getattr(team, "lead", None)
        dept = getattr(team, "department", None)
        rows.append(
            {
                "team": team.name,
                "department": dept.name if dept else "",
                "lead": _person_name(lead) if lead else "",
                # Employees attach to departments, not teams — the honest,
                # labelled proxy is the department's headcount.
                "department_headcount": dept_counts.get(dept.id, 0) if dept else 0,
            }
        )
    if not rows:
        return [], "No teams defined yet."
    return rows, None


def _policies_source(params, user):
    from policies.models import CompanyPolicy  # noqa: PLC0415

    queryset = CompanyPolicy.objects.annotate(
        ack_count=Count("acknowledgments")
    ).order_by("-created_at")
    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(title__icontains=search) | Q(description__icontains=search)
        )
    rows = [
        {
            "title": policy.title,
            "requires_ack": "yes" if policy.requires_acknowledgment else "no",
            "acks": policy.ack_count,
            "active": "yes" if policy.is_active else "no",
            "created": policy.created_at.date().isoformat(),
        }
        for policy in queryset
    ]
    if not rows:
        return [], "No company policies published yet."
    return rows, None


def run_report(report_type, params, user, *, columns=None):
    """Resolve one report to ``(columns, rows, unavailable)``."""
    definition = REPORTS[report_type]
    source = definition["source"]
    wanted = columns or definition["columns"]
    # `columns=` may only narrow to known keys — never invent new ones.
    known = set(definition["columns"]) | set(FIELDS)
    picked = [c for c in wanted if c in known] or definition["columns"]

    if source == "employees":
        rows, unavailable = _employee_source(params, picked, user=user)
    elif source == "without_manager":
        rows, unavailable = _employee_source(params, picked, user=user)
        rows = [r for r in rows if not r.get("reporting_to")]
    elif source == "new_joiners":
        rows, unavailable = _new_joiners_source(params, user, columns=picked)
    elif source == "roles":
        rows, unavailable = _roles_source(params, user)
    elif source == "reporting_managers":
        rows, unavailable = _managers_source(params, user)
    elif source == "documents":
        rows, unavailable = _documents_source(params, user)
    elif source == "headcount_department":
        rows, unavailable = _bucket_source("department", params)
    elif source == "headcount_location":
        rows, unavailable = _bucket_source("location", params)
    elif source == "gender":
        rows, unavailable = _gender_source(params, user)
    elif source == "tenure":
        rows, unavailable = _tenure_source(params, user)
    elif source == "invites":
        rows, unavailable = _invites_source(params, user)
    elif source == "registration":
        rows, unavailable = _registration_source(params, user)
    elif source == "exits":
        rows, unavailable = _exits_source(params, user)
    elif source == "logins":
        rows, unavailable = _logins_source(params, user)
    elif source == "headcount_summary":
        rows, unavailable = _headcount_summary_source(params, user)
    elif source == "vacancy":
        rows, unavailable = _vacancy_source(params, user)
    elif source == "teams":
        rows, unavailable = _teams_source(params, user)
    elif source == "policies":
        rows, unavailable = _policies_source(params, user)
    else:  # "empty"
        rows, unavailable = [], definition.get("unavailable", "No data source yet.")
    return picked, rows, unavailable


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------

def _catalog():
    categories = []
    for category in CATEGORIES:
        if category["id"] == "home":
            continue
        cards = []
        for report_id, definition in REPORTS.items():
            if definition["category"] != category["id"]:
                continue
            cards.append(
                {
                    "id": report_id,
                    "title": definition["title"],
                    "description": definition["description"],
                    "wired": definition["source"] != "empty",
                    "unavailable": definition.get("unavailable"),
                }
            )
        categories.append(
            {"id": category["id"], "label": category["label"], "reports": cards}
        )
    return {"categories": categories, "field_groups": _field_groups()}


class ReportCatalogView(APIView):
    """Sidebar categories + report cards + wizard field groups (org.read)."""

    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]

    def get(self, request):
        return Response({"success": True, "data": _catalog()})


def _report_payload(report_type, params, user):
    definition = REPORTS[report_type]
    base_columns = definition["columns"]
    columns_param = (params.get("columns") or "").strip()
    picked = (
        [c.strip() for c in columns_param.split(",") if c.strip()]
        or base_columns
    )
    columns, rows, unavailable = run_report(
        report_type, params, user, columns=picked
    )
    return {
        "type": report_type,
        "title": definition["title"],
        "description": definition["description"],
        "category": definition["category"],
        "wired": definition["source"] != "empty",
        "columns": _column_meta(columns),
        "rows": rows,
        "total": len(rows),
        "unavailable": unavailable,
    }


class ReportRunView(APIView):
    """``?type=<report>`` (or ``?custom=<id>`` for a saved report)."""

    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]

    def get(self, request):
        params = request.query_params.dict()
        custom_id = (params.get("custom") or "").strip()
        if custom_id:
            try:
                saved = CustomReport.objects.get(pk=int(custom_id), owner=request.user)
            except (CustomReport.DoesNotExist, ValueError):
                return Response(
                    {
                        "success": False,
                        "error": {
                            "code": "NOT_FOUND",
                            "message": "Saved report not found.",
                            "fields": {},
                        },
                    },
                    status=404,
                )
            if saved.base_type not in REPORTS:
                return Response(
                    {
                        "success": False,
                        "error": {
                            "code": "UNKNOWN_REPORT",
                            "message": f"Unknown base report '{saved.base_type}'.",
                            "fields": {},
                        },
                    },
                    status=400,
                )
            merged = dict(saved.filters or {})
            merged.update(
                {k: v for k, v in params.items() if k in FILTER_KEYS and v}
            )
            payload = _report_payload(saved.base_type, merged, request.user)
            definition = REPORTS[saved.base_type]
            if definition["source"] in ("employees", "without_manager", "new_joiners"):
                picked = [c for c in (saved.selected_fields or []) if c in FIELDS]
                if picked:
                    _, rows, _ = run_report(
                        saved.base_type, merged, request.user, columns=picked
                    )
                    payload["columns"] = _column_meta(picked)
                    payload["rows"] = rows
                    payload["total"] = len(rows)
            payload["custom"] = {"id": saved.id, "name": saved.name}
            return Response({"success": True, "data": payload})
        report_type = (params.get("type") or "").strip()
        if report_type not in REPORTS:
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": "UNKNOWN_REPORT",
                        "message": f"Unknown report '{report_type}'.",
                        "fields": {"type": sorted(REPORTS)},
                    },
                },
                status=400,
            )
        return Response(
            {"success": True, "data": _report_payload(report_type, params, request.user)}
        )


class ReportExportView(APIView):
    """Same as run, rendered as a CSV download (org.read)."""

    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]

    def get(self, request):
        params = request.query_params.dict()
        report_type = (params.get("type") or "").strip()
        if report_type not in REPORTS:
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": "UNKNOWN_REPORT",
                        "message": f"Unknown report '{report_type}'.",
                        "fields": {"type": sorted(REPORTS)},
                    },
                },
                status=400,
            )
        payload = _report_payload(report_type, params, request.user)
        stamp = timezone.now().date().isoformat()
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="{report_type}-{stamp}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow([c["label"] for c in payload["columns"]])
        for row in payload["rows"]:
            writer.writerow([row.get(c["key"], "") for c in payload["columns"]])
        return response


class CustomReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomReport
        fields = [
            "id",
            "name",
            "base_type",
            "selected_fields",
            "filters",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_base_type(self, value):
        if value not in REPORTS:
            raise serializers.ValidationError(f"Unknown base report '{value}'.")
        if REPORTS[value]["source"] not in ("employees", "without_manager", "new_joiners"):
            raise serializers.ValidationError(
                "Custom reports can only be built on employee-sourced reports."
            )
        return value

    def validate_selected_fields(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Pick at least one field.")
        unknown = [c for c in value if c not in FIELDS]
        if unknown:
            raise serializers.ValidationError(f"Unknown fields: {', '.join(unknown)}.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        name = attrs.get("name", getattr(self.instance, "name", None))
        if request is not None and name is not None:
            clash = CustomReport.objects.filter(owner=request.user, name=name)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {"name": "You already have a saved report with this name."}
                )
        return attrs

    def validate_filters(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Filters must be an object.")
        unknown = [k for k in value if k not in FILTER_KEYS]
        if unknown:
            raise serializers.ValidationError(f"Unknown filters: {', '.join(unknown)}.")
        return {k: str(v) for k, v in value.items() if v}


class CustomReportViewSet(viewsets.ModelViewSet):
    """Saved custom reports — each caller only sees their own rows."""

    serializer_class = CustomReportSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return CustomReport.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
