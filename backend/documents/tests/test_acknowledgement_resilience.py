"""Resilience / edge coverage for the acknowledgement endpoints — bad ids,
missing employee records, audience boundaries. Complements
test_acknowledgement.py (the happy-path semantics)."""

import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from documents.models import Document, DocumentAcknowledgement
from employees.models import Employee


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Verify@12345", **kw)


@pytest.mark.django_db
def test_acknowledge_nonexistent_is_404_and_unauth_is_401():
    u = _user("r1@x.com")
    Employee.objects.create(user=u, employee_code="R1")
    c = APIClient(); c.force_authenticate(u)
    assert c.post(f"/api/v1/documents/{uuid.uuid4()}/acknowledge").status_code == 404
    # Unauthenticated (no force_authenticate) -> 401, never a 500.
    assert APIClient().post(f"/api/v1/documents/{uuid.uuid4()}/acknowledge").status_code == 401


@pytest.mark.django_db
def test_user_without_employee_record_cannot_acknowledge():
    hr = _user("r2hr@x.com", is_superuser=True)
    doc = Document.objects.create(
        entity_type="organization_document", entity_id="org",
        file=SimpleUploadedFile("p.pdf", b"p"), original_name="p.pdf", original_filename="p.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES, acknowledgement_required=True,
    )
    no_emp = _user("r2@x.com")  # authenticated but has no Employee row
    c = APIClient(); c.force_authenticate(no_emp)
    # Must be a clean 4xx, not a 500.
    assert c.post(f"/api/v1/documents/{doc.id}/acknowledge").status_code in (403, 400)


@pytest.mark.django_db
def test_employee_audience_is_owner_only():
    hr = _user("r3hr@x.com", is_superuser=True)
    u1, u2 = _user("r3a@x.com"), _user("r3b@x.com")
    e1 = Employee.objects.create(user=u1, employee_code="R3A")
    Employee.objects.create(user=u2, employee_code="R3B")
    # employee-audience doc attached to e1 (has a real subject).
    doc = Document.objects.create(
        entity_type="employee_document", entity_id=str(e1.pk), employee=e1,
        file=SimpleUploadedFile("own.pdf", b"o"), original_name="own.pdf", original_filename="own.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_EMPLOYEE, acknowledgement_required=True,
    )
    # Owner sees it as pending and can acknowledge.
    c1 = APIClient(); c1.force_authenticate(u1)
    assert str(doc.id) in [str(d["id"]) for d in c1.get("/api/v1/documents/pending-acknowledgement").json()["data"]]
    assert c1.post(f"/api/v1/documents/{doc.id}/acknowledge").status_code == 204
    # A different employee cannot see or acknowledge it.
    c2 = APIClient(); c2.force_authenticate(u2)
    assert str(doc.id) not in [str(d["id"]) for d in c2.get("/api/v1/documents/pending-acknowledgement").json()["data"]]
    assert c2.post(f"/api/v1/documents/{doc.id}/acknowledge").status_code == 403


@pytest.mark.django_db
def test_pending_excludes_non_required_and_status_stable_after_repeat_ack():
    hr = _user("r4hr@x.com", is_superuser=True)
    u1 = _user("r4a@x.com")
    e1 = Employee.objects.create(user=u1, employee_code="R4A")

    def _doc(ack):
        return Document.objects.create(
            entity_type="organization_document", entity_id="org",
            file=SimpleUploadedFile("d.pdf", b"d"), original_name="d.pdf", original_filename="d.pdf",
            size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES, acknowledgement_required=ack,
        )

    required, optional = _doc(True), _doc(False)
    c1 = APIClient(); c1.force_authenticate(u1)
    pending_ids = [str(d["id"]) for d in c1.get("/api/v1/documents/pending-acknowledgement").json()["data"]]
    assert str(required.id) in pending_ids and str(optional.id) not in pending_ids

    # Idempotent acknowledge keeps counts consistent.
    c1.post(f"/api/v1/documents/{required.id}/acknowledge")
    c1.post(f"/api/v1/documents/{required.id}/acknowledge")
    assert DocumentAcknowledgement.objects.filter(document=required, employee=e1).count() == 1
    chr = APIClient(); chr.force_authenticate(hr)
    data = chr.get(f"/api/v1/documents/{required.id}/acknowledgements").json()["data"]
    assert data["acknowledged"] == 1 and data["total"] == data["acknowledged"] + data["pending"]
