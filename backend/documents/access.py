"""
Per-`entity_type` access matrix (docs/ARCHITECTURE.md primitive #6). No
blanket rule beyond this — a role/entity_type combination not listed here is
denied (docs/REQUIREMENTS.md open question #4).
"""
from core.scope import is_finance, is_hr_admin, visible_employee_ids

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


def can_access(user, document) -> bool:
    if is_hr_admin(user):
        return True
    if document.employee_id and document.employee_id == getattr(getattr(user, 'employee', None), 'id', None):
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
    return False
