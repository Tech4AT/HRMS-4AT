"""
Per-`entity_type` access matrix (docs/ARCHITECTURE.md primitive #6). No
blanket rule beyond this — a role/entity_type combination not listed here is
denied (docs/REQUIREMENTS.md open question #4).

Two layers:

1. `ENTITY_PERMISSIONS` — the DOC-ACL-GAP fix: every entity_type the app
   stores maps to the RBAC permission code a non-owner must hold (at a scope
   covering the document's employee) to read it. An entity_type with no entry
   here is *undeclared* and denied outright (list/upload refuse it; per-row
   `can_access` returns False for everyone but HR Admin).
2. The legacy grants below (finance offer letters, onboarding access grants,
   manager-visible org types) predate the mapping and are kept as additional
   grant paths — the mapping only ever widens, never narrows.
"""
from core.scope import (
    is_finance,
    is_hr_admin,
    resolve_employee_scope,
    user_has_permission,
    visible_employee_ids,
)

# entity_type -> RBAC permission code a non-owner must hold (at a scope
# covering the document's employee) to read documents of that type.
# 'employee_document' is the generic per-employee file bucket (Org >
# Documents tab, HR-issued letters/certs): personal employment paperwork, so
# it keys off employees.personal.read, the same code that gates other
# personal details. Onboarding-flow types key off onboarding.read; the
# employee-owned career buckets (resume / certificates / past experience)
# key off employees.read.
ENTITY_PERMISSIONS = {
    # Org-wide policy/notice documents (Org > Organization Documents). Not tied
    # to one employee — visibility is governed by the per-document `audience`
    # (see _entity_allowed / _audience_allows below), not an employee-subject
    # scope. Declared here so it isn't treated as an undeclared/probing type.
    'organization_document': 'documents.read',
    'employee_document': 'employees.personal.read',
    'onboarding_task': 'onboarding.read',
    'identity_document': 'onboarding.read',
    'education_record': 'onboarding.read',
    'employee_letter': 'onboarding.read',
    'offer_letter': 'onboarding.read',
    'resume': 'employees.read',
    'employee_certificate': 'employees.read',
    'employee_experience': 'employees.read',
}

# entity_types whose entity_id IS the owning employee's pk (so "the owner"
# can be resolved from the filter alone, even for an empty folder).
_EMPLOYEE_KEYED_TYPES = frozenset({
    'employee_document',
    'resume',
    'employee_certificate',
    'employee_experience',
})

# entity_type -> which roles may read *any* document of that type, beyond the
# owning employee (who can always read their own) and hr_admin (who can
# always read everything — enforced separately below). Deliberately excludes
# 'identity_document' (Aadhaar/PAN-bearing PII — self, hr_admin, finance
# only, per IdentityDocumentsDetailView) and 'offer_letter' (carries salary,
# see below) even though a manager can see everything else about their
# direct reports' documents.
_ORG_READABLE_BY_MANAGER = {'onboarding_task', 'resume', 'employee_certificate', 'employee_experience'}

# offer_letter carries salary — per docs/REQUIREMENTS.md's security baseline
# ("salary ... readable only by hr_admin and finance"), it is deliberately
# NOT in _ORG_READABLE_BY_MANAGER even though other onboarding documents are.
_READABLE_BY_FINANCE = {'offer_letter'}

# entity_type -> the onboarding access-grant area that lets a named person
# (e.g. payroll, see onboarding.models.OnboardingAccessGrant) read it.
_READABLE_BY_GRANT = {'identity_document': 'identity_documents', 'education_record': 'education'}


def _subject_employee_id(document):
    """The employee this document is *about*. Prefer the direct FK; fall back
    to the entity pair for employee-keyed types (legacy rows were created with
    only (entity_type, entity_id) and no FK — e.g. the conformance fixtures —
    and the owner must still reach their own files)."""
    if document.employee_id:
        return document.employee_id
    if document.entity_type in _EMPLOYEE_KEYED_TYPES:
        try:
            return int(document.entity_id)
        except (TypeError, ValueError):
            return None
    return None


def _entity_allowed(user, document) -> bool:
    """The pre-audience grant paths: owner shortcut, finance, access grants,
    manager-visible org types, and the RBAC-code mapping. Audience (below)
    only ever restricts past this point, never widens."""
    me = getattr(getattr(user, 'employee', None), 'id', None)
    subject_id = _subject_employee_id(document)
    # Org-wide documents have no employee subject; the base entity check passes
    # for any authenticated employee and _audience_allows narrows by audience.
    if document.entity_type == 'organization_document':
        return me is not None
    if subject_id is not None and me is not None and subject_id == me:
        return True
    if document.entity_type in _READABLE_BY_FINANCE and is_finance(user):
        return True
    area = _READABLE_BY_GRANT.get(document.entity_type)
    if area:
        from onboarding.models import has_access_grant

        if has_access_grant(user, area):
            return True
    if document.entity_type in _ORG_READABLE_BY_MANAGER and document.employee_id:
        return document.employee_id in visible_employee_ids(user)
    # RBAC-code mapping (DOC-ACL-GAP fix): a holder of the mapped permission
    # whose scope covers the document's employee may read it — e.g. an HR
    # staffer granted employees.personal.read at ALL sees employee_document
    # rows, with no role hard-coded here.
    code = ENTITY_PERMISSIONS.get(document.entity_type)
    if code and subject_id is not None:
        scope_ids = resolve_employee_scope(user, code).values_list('pk', flat=True)
        if subject_id in set(scope_ids):
            return True
    return False


def _user_role_ids(user) -> set:
    try:
        return set(user.roles.values_list('id', flat=True))
    except Exception:
        return set()


def _audience_role_ids(document) -> set:
    """Role ids this document is scoped to (empty => enum governs instead)."""
    try:
        return set(document.audience_roles.values_list('role_id', flat=True))
    except Exception:
        return set()


def user_must_acknowledge(user, document) -> bool:
    """Whether THIS user is required to acknowledge the document. Role-based
    audience wins: a user must acknowledge if any role they hold is listed on
    the document with acknowledge_required=True. With no role rows, the legacy
    global `acknowledgement_required` flag applies."""
    from .models import DocumentAudienceRole

    if _audience_role_ids(document):
        my_roles = _user_role_ids(user)
        if not my_roles:
            return False
        return DocumentAudienceRole.objects.filter(
            document=document, role_id__in=my_roles, acknowledge_required=True
        ).exists()
    return bool(getattr(document, 'acknowledgement_required', False))


def _audience_allows(user, document) -> bool:
    """Per-document audience gate. Runs AFTER _entity_allowed — a document the
    entity rules already deny stays denied; this only narrows further."""
    from .models import Document

    # Role-based audience (Org documents): when a document names specific roles,
    # that list REPLACES the coarse enum — visible iff the user holds a listed
    # role. HR Admin is already allowed before this runs (see can_access).
    role_ids = _audience_role_ids(document)
    if role_ids:
        return bool(_user_role_ids(user) & role_ids)

    audience = getattr(document, 'audience', None) or Document.AUDIENCE_ALL_EMPLOYEES
    if audience == Document.AUDIENCE_ALL_EMPLOYEES:
        return True
    if audience == Document.AUDIENCE_HR_ONLY:
        return False  # HR Admin returned True before this is ever reached.
    me = getattr(getattr(user, 'employee', None), 'id', None)
    subject_id = _subject_employee_id(document)
    if audience == Document.AUDIENCE_EMPLOYEE:
        return me is not None and subject_id is not None and me == subject_id
    if audience == Document.AUDIENCE_HR_AND_MANAGER:
        # HR Admin is handled above; a manager is anyone whose scope covers
        # the subject employee — the same visibility the manager-readable org
        # types above already key off (default employees.read scope).
        if document.entity_type == 'organization_document':
            # Org-wide: no single subject — a "manager" is anyone with
            # oversight of at least one employee besides themselves.
            return bool(set(visible_employee_ids(user)) - ({me} if me is not None else set()))
        return subject_id is not None and subject_id in visible_employee_ids(user)
    return False  # Unknown audience value: deny rather than leak.


def can_access(user, document) -> bool:
    if is_hr_admin(user):
        return True
    # Undeclared entity_type: denied outright, even to the owning employee.
    # The app only ever creates the ENTITY_PERMISSIONS types above; anything
    # else is a probing or corrupt row and must not leak through the
    # owner shortcut below.
    if document.entity_type not in ENTITY_PERMISSIONS:
        return False
    if not _entity_allowed(user, document):
        return False
    return _audience_allows(user, document)


def can_access_entity(user, entity_type: str, entity_id) -> bool:
    """Folder-level check for `GET /documents?entityType=&entityId=`: may
    `user` see this (type, id) bucket at all — used when no visible row
    answers the question (empty folder, or every row filtered out). Owners
    see their own (possibly empty) employee-keyed folder; anyone else needs
    the mapped RBAC code at any scope (scope only matters once rows exist,
    and an empty answer leaks nothing)."""
    if is_hr_admin(user):
        return True
    code = ENTITY_PERMISSIONS.get(entity_type)
    if code is None:
        return False
    if entity_type in _EMPLOYEE_KEYED_TYPES:
        try:
            subject_id = int(entity_id)
        except (TypeError, ValueError):
            return False
        me = getattr(getattr(user, 'employee', None), 'id', None)
        if me is not None and me == subject_id:
            return True
    return user_has_permission(user, code)
