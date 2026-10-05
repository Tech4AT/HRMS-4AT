"""Acknowledgement endpoints: acknowledge (idempotent, requires can_access +
ack-required), scope-filtered status (audience-aware population, HR/manager
only), and pending-acknowledgement (visible + required + not-yet-acked)."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Permission, User, UserPermissionOverride
from documents.models import Document, DocumentAcknowledgement
from employees.models import Employee


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Verify@12345", **kw)


def _grant(user, code):
    UserPermissionOverride.objects.create(
        user=user, permission=Permission.objects.get(code=code), scope_tier="all", is_granted=True
    )


def _org_doc(uploader, audience=Document.AUDIENCE_ALL_EMPLOYEES, ack=True):
    return Document.objects.create(
        entity_type="organization_document",
        entity_id="org",
        file=SimpleUploadedFile("policy.pdf", b"policy"),
        original_name="policy.pdf",
        original_filename="policy.pdf",
        size=6,
        uploaded_by=uploader,
        audience=audience,
        acknowledgement_required=ack,
    )


@pytest.mark.django_db
def test_all_employees_doc_acknowledge_status_and_pending_flow():
    hr = _user("hr@x.com", is_superuser=True, is_staff=True)  # is_hr_admin => True
    u1, u2 = _user("e1@x.com"), _user("e2@x.com")
    e1 = Employee.objects.create(user=u1, employee_code="E1", first_name="Ann")
    e2 = Employee.objects.create(user=u2, employee_code="E2", first_name="Bob")
    doc = _org_doc(hr)

    # e1 acknowledges (idempotent: twice => still 204, one row)
    c1 = APIClient(); c1.force_authenticate(u1)
    assert c1.post(f"/api/v1/documents/{doc.id}/acknowledge").status_code == 204
    assert c1.post(f"/api/v1/documents/{doc.id}/acknowledge").status_code == 204
    assert DocumentAcknowledgement.objects.filter(document=doc).count() == 1

    # HR status view: target population = all employees (audience all_employees),
    # 1 acknowledged, 1 pending.
    chr = APIClient(); chr.force_authenticate(hr)
    data = chr.get(f"/api/v1/documents/{doc.id}/acknowledgements").json()["data"]
    assert data["total"] == 2 and data["acknowledged"] == 1 and data["pending"] == 1
    acked = {i["employee"]: i["acknowledged"] for i in data["items"]}
    assert acked[e1.id] is True and acked[e2.id] is False

    # pending-acknowledgement: e1 no longer lists it; e2 still does.
    assert str(doc.id) not in [str(d["id"]) for d in c1.get("/api/v1/documents/pending-acknowledgement").json()["data"]]
    c2 = APIClient(); c2.force_authenticate(u2)
    assert str(doc.id) in [str(d["id"]) for d in c2.get("/api/v1/documents/pending-acknowledgement").json()["data"]]


@pytest.mark.django_db
def test_acknowledge_rejects_non_required_and_plain_employee_cannot_view_status():
    hr = _user("hr2@x.com", is_superuser=True)
    u1 = _user("p1@x.com")
    Employee.objects.create(user=u1, employee_code="P1")
    not_required = _org_doc(hr, ack=False)

    c1 = APIClient(); c1.force_authenticate(u1)
    # Acknowledging a doc that doesn't require it => 400.
    assert c1.post(f"/api/v1/documents/{not_required.id}/acknowledge").status_code == 400
    # A plain employee (scope over nobody but self) cannot read the HR status view.
    doc = _org_doc(hr)
    assert c1.get(f"/api/v1/documents/{doc.id}/acknowledgements").status_code == 403


@pytest.mark.django_db
def test_hr_only_audience_excludes_plain_employees_from_population_and_pending():
    hr = _user("hr3@x.com", is_superuser=True)
    u1 = _user("q1@x.com")
    Employee.objects.create(user=u1, employee_code="Q1")
    doc = _org_doc(hr, audience=Document.AUDIENCE_HR_ONLY)

    # Plain employee can't see an hr_only doc => not in their pending list.
    c1 = APIClient(); c1.force_authenticate(u1)
    assert str(doc.id) not in [str(d["id"]) for d in c1.get("/api/v1/documents/pending-acknowledgement").json()["data"]]

    # HR status: target population for hr_only excludes plain employees => 0.
    chr = APIClient(); chr.force_authenticate(hr)
    data = chr.get(f"/api/v1/documents/{doc.id}/acknowledgements").json()["data"]
    assert data["total"] == 0
