"""Conformance for the documents primitive: the per-entity_type access matrix
gates upload, list and download — the owner and matrix-permission holders get in,
everyone else is refused, and an undeclared entity_type is denied outright."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Permission, User, UserPermissionOverride
from documents.models import Document
from employees.models import Employee


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


def _grant(user, code):
    UserPermissionOverride.objects.create(
        user=user, permission=Permission.objects.get(code=code), scope_tier="all", is_granted=True
    )


@pytest.mark.django_db
def test_owner_can_upload_list_and_download_own_document():
    owner = _user("owner@x.com")
    employee = Employee.objects.create(user=owner, employee_code="E1")

    client = APIClient()
    client.force_authenticate(owner)
    upload = SimpleUploadedFile("contract.pdf", b"hello", content_type="application/pdf")
    res = client.post(
        "/api/v1/documents",
        {"entity_type": "employee_document", "entity_id": str(employee.pk), "file": upload},
        format="multipart",
    )
    assert res.status_code == 201
    doc_id = res.json()["data"]["id"]

    listed = client.get(
        f"/api/v1/documents?entity_type=employee_document&entity_id={employee.pk}"
    ).json()["data"]
    assert len(listed) == 1

    dl = client.get(f"/api/v1/documents/{doc_id}/download")
    assert dl.status_code == 200
    assert b"".join(dl.streaming_content) == b"hello"


@pytest.mark.django_db
def test_matrix_permission_holder_gets_access_and_stranger_is_refused():
    owner = _user("o@x.com")
    employee = Employee.objects.create(user=owner, employee_code="E2")
    doc = Document.objects.create(
        entity_type="employee_document",
        entity_id=str(employee.pk),
        file=SimpleUploadedFile("id.pdf", b"x"),
        original_name="id.pdf",
        size=1,
        uploaded_by=owner,
    )

    hr = _user("hr@x.com")
    _grant(hr, "employees.personal.read")
    hr_client = APIClient()
    hr_client.force_authenticate(hr)
    assert hr_client.get(f"/api/v1/documents/{doc.id}/download").status_code == 200

    stranger = _user("s@x.com")
    Employee.objects.create(user=stranger, employee_code="E3")
    s_client = APIClient()
    s_client.force_authenticate(stranger)
    assert s_client.get(f"/api/v1/documents/{doc.id}/download").status_code == 403
    assert (
        s_client.get(
            f"/api/v1/documents?entity_type=employee_document&entity_id={employee.pk}"
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_undeclared_entity_type_is_denied():
    owner = _user("u@x.com")
    Employee.objects.create(user=owner, employee_code="E4")
    client = APIClient()
    client.force_authenticate(owner)
    res = client.get("/api/v1/documents?entity_type=mystery&entity_id=1")
    assert res.status_code == 403
