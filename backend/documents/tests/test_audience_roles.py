"""Role-based document audience (Org > Organization Documents): a document may
name specific RBAC roles, and per-role whether that role must acknowledge or
only view. When any role rows exist they REPLACE the coarse audience enum:
visible iff the user holds a listed role (HR Admin always sees everything);
acknowledgement is required per-role."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Role, User
from core.enums import RoleArchetype
from documents.access import can_access, user_must_acknowledge
from documents.models import Document, DocumentAudienceRole
from employees.models import Employee


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Aud@12345", **kw)


def _role(name):
    return Role.objects.create(name=name, archetype=RoleArchetype.EMPLOYEE)


def _org_doc(uploader):
    return Document.objects.create(
        entity_type="organization_document", entity_id="org",
        file=SimpleUploadedFile("p.pdf", b"p"), original_name="p.pdf", original_filename="p.pdf",
        size=1, uploaded_by=uploader, audience=Document.AUDIENCE_ALL_EMPLOYEES,
    )


@pytest.mark.django_db
def test_role_audience_gates_visibility_and_per_role_ack():
    hr = _user("ar_hr@x.com", is_superuser=True)
    u_mgr, u_emp, u_other = _user("mgr@x.com"), _user("emp@x.com"), _user("other@x.com")
    for u in (u_mgr, u_emp, u_other):
        Employee.objects.create(user=u, employee_code=f"E{u.id}", first_name="X")
    manager, employee = _role("AudManager"), _role("AudEmployee")
    u_mgr.roles.add(manager)
    u_emp.roles.add(employee)
    # u_other holds neither role.

    doc = _org_doc(hr)
    DocumentAudienceRole.objects.create(document=doc, role=manager, acknowledge_required=False)  # view only
    DocumentAudienceRole.objects.create(document=doc, role=employee, acknowledge_required=True)   # must ack

    # Visibility: only role-holders (+ HR) see it; the enum default is ignored.
    assert can_access(u_mgr, doc) is True
    assert can_access(u_emp, doc) is True
    assert can_access(u_other, doc) is False
    assert can_access(hr, doc) is True  # HR Admin sees everything

    # Per-role acknowledgement.
    assert user_must_acknowledge(u_emp, doc) is True       # Employee role => ack
    assert user_must_acknowledge(u_mgr, doc) is False      # Manager role => view only
    assert user_must_acknowledge(u_other, doc) is False    # not an audience role


@pytest.mark.django_db
def test_create_and_edit_via_api_sets_roles():
    hr = _user("ar_hr2@x.com", is_superuser=True)
    r1, r2 = _role("Alpha"), _role("Beta")
    c = APIClient(); c.force_authenticate(hr)

    # Create with role audience (multipart, roles as JSON string).
    import json
    res = c.post(
        "/api/v1/documents",
        {
            "file": SimpleUploadedFile("d.pdf", b"d"),
            "entityType": "organization_document",
            "entityId": "org",
            "title": "Policy",
            "audienceRoles": json.dumps([
                {"roleId": r1.id, "acknowledgeRequired": True},
                {"roleId": r2.id, "acknowledgeRequired": False},
            ]),
        },
        format="multipart",
    )
    assert res.status_code == 201, res.content
    doc_id = res.json()["data"]["id"]
    doc = Document.objects.get(pk=doc_id)
    assert doc.audience_roles.count() == 2

    # Edit: replace with just r2 (view only).
    res = c.patch(
        f"/api/v1/documents/{doc_id}",
        {"audienceRoles": [{"roleId": r2.id, "acknowledgeRequired": False}]},
        format="json",
    )
    assert res.status_code == 200, res.content
    rows = list(doc.audience_roles.all())
    assert len(rows) == 1 and rows[0].role_id == r2.id and rows[0].acknowledge_required is False
    # Non-HR cannot edit.
    plain = _user("plain@x.com")
    Employee.objects.create(user=plain, employee_code="EP", first_name="P")
    c2 = APIClient(); c2.force_authenticate(plain)
    assert c2.patch(f"/api/v1/documents/{doc_id}", {"title": "hax"}, format="json").status_code == 403


@pytest.mark.django_db
def test_no_roles_falls_back_to_enum():
    hr = _user("ar_hr3@x.com", is_superuser=True)
    doc = _org_doc(hr)  # all_employees, no role rows
    u = _user("plain2@x.com")
    Employee.objects.create(user=u, employee_code="EP2", first_name="P")
    assert can_access(u, doc) is True  # enum all_employees still governs
    assert user_must_acknowledge(u, doc) is False  # global flag False
