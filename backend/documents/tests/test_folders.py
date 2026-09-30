"""Organization Documents folders subsystem: folder visibility (public/private),
folder CRUD RBAC (HR only), folder document listing, title/description/folder
persistence on upload, and acknowledgement reminders."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from documents.models import Document, DocumentFolder
from employees.models import Employee


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Verify@12345", **kw)


@pytest.mark.django_db
def test_public_folders_visible_to_all_private_to_hr_only():
    hr = _user("f_hr@x.com", is_superuser=True)
    u = _user("f_emp@x.com")
    Employee.objects.create(user=u, employee_code="F1")
    pub = DocumentFolder.objects.create(name="HR Policies", visibility="public")
    DocumentFolder.objects.create(name="Test", visibility="private")

    emp_folders = APIClient(); emp_folders.force_authenticate(u)
    names = {f["name"] for f in emp_folders.get("/api/v1/documents/folders").json()["data"]}
    assert names == {"HR Policies"}  # private hidden from a plain employee

    hr_c = APIClient(); hr_c.force_authenticate(hr)
    hr_names = {f["name"] for f in hr_c.get("/api/v1/documents/folders").json()["data"]}
    assert hr_names == {"HR Policies", "Test"}
    assert pub.name in hr_names


@pytest.mark.django_db
def test_folder_crud_is_hr_only_and_delete_detaches_documents():
    hr = _user("f2_hr@x.com", is_superuser=True)
    u = _user("f2_emp@x.com")
    Employee.objects.create(user=u, employee_code="F2")

    emp = APIClient(); emp.force_authenticate(u)
    assert emp.post("/api/v1/documents/folders", {"name": "X"}, format="json").status_code == 403

    hr_c = APIClient(); hr_c.force_authenticate(hr)
    created = hr_c.post("/api/v1/documents/folders", {"name": "Compliance", "visibility": "public"}, format="json")
    assert created.status_code == 201
    fid = created.json()["data"]["id"]

    # A doc in the folder survives folder deletion (SET_NULL), unfiled.
    doc = Document.objects.create(
        entity_type="organization_document", entity_id="org", folder_id=fid,
        file=SimpleUploadedFile("p.pdf", b"p"), original_name="p.pdf", original_filename="p.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES,
    )
    assert emp.delete(f"/api/v1/documents/folders/{fid}").status_code == 403  # non-HR blocked
    assert hr_c.delete(f"/api/v1/documents/folders/{fid}").status_code == 204
    doc.refresh_from_db()
    assert doc.folder_id is None and Document.objects.filter(pk=doc.pk).exists()


@pytest.mark.django_db
def test_upload_persists_title_description_and_folder():
    hr = _user("f3_hr@x.com", is_superuser=True)
    folder = DocumentFolder.objects.create(name="Ops", visibility="public")
    hr_c = APIClient(); hr_c.force_authenticate(hr)
    up = SimpleUploadedFile("policy-v2.pdf", b"hello", content_type="application/pdf")
    res = hr_c.post("/api/v1/documents", {
        "entityType": "organization_document", "entityId": "org", "file": up,
        "title": "Leave Policy", "description": "FY26 leave rules", "folderId": str(folder.id),
        "audience": "all_employees", "acknowledgementRequired": "true",
    }, format="multipart")
    assert res.status_code == 201
    d = Document.objects.get(pk=res.json()["data"]["id"])
    assert d.title == "Leave Policy" and d.description == "FY26 leave rules"
    assert d.folder_id == folder.id and d.acknowledgement_required is True
    # Folder document listing returns it (audience-filtered).
    listed = hr_c.get(f"/api/v1/documents/folders/{folder.id}/documents").json()["data"]
    assert [x["id"] for x in listed] == [str(d.id)] and listed[0]["title"] == "Leave Policy"


@pytest.mark.django_db
def test_remind_notifies_only_pending_and_gates_on_hr():
    from notifications.models import Notification
    hr = _user("f4_hr@x.com", is_superuser=True)
    u1, u2 = _user("f4a@x.com"), _user("f4b@x.com")
    e1 = Employee.objects.create(user=u1, employee_code="F4A")
    Employee.objects.create(user=u2, employee_code="F4B")
    doc = Document.objects.create(
        entity_type="organization_document", entity_id="org",
        file=SimpleUploadedFile("d.pdf", b"d"), original_name="d.pdf", original_filename="d.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES, acknowledgement_required=True,
    )
    # e1 acknowledges; only e2 should be reminded.
    c1 = APIClient(); c1.force_authenticate(u1)
    c1.post(f"/api/v1/documents/{doc.id}/acknowledge")

    # Non-HR cannot trigger reminders.
    assert c1.post(f"/api/v1/documents/{doc.id}/remind-acknowledgement").status_code == 403

    before = Notification.objects.count()
    hr_c = APIClient(); hr_c.force_authenticate(hr)
    res = hr_c.post(f"/api/v1/documents/{doc.id}/remind-acknowledgement")
    assert res.status_code == 200 and res.json()["data"]["notified"] == 1
    assert Notification.objects.count() == before + 1  # only e2 (u2) notified


@pytest.mark.django_db
def test_remind_rejects_non_required_document():
    hr = _user("f5_hr@x.com", is_superuser=True)
    doc = Document.objects.create(
        entity_type="organization_document", entity_id="org",
        file=SimpleUploadedFile("n.pdf", b"n"), original_name="n.pdf", original_filename="n.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES, acknowledgement_required=False,
    )
    hr_c = APIClient(); hr_c.force_authenticate(hr)
    assert hr_c.post(f"/api/v1/documents/{doc.id}/remind-acknowledgement").status_code == 400
