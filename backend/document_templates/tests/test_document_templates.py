"""Document templates engine: folders, CRUD RBAC (HR-manage only), filters,
and the generate stamp. Own app — no documents-app migration."""

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from document_templates.models import DocumentTemplate, TemplateFolder
from employees.models import Employee


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Verify@12345", **kw)


@pytest.fixture
def clients(db):
    hr = _user("t_hr@x.com", is_superuser=True)
    u = _user("t_emp@x.com")
    Employee.objects.create(user=u, employee_code="T1")
    hr_c = APIClient()
    hr_c.force_authenticate(hr)
    emp = APIClient()
    emp.force_authenticate(u)
    return hr_c, emp


def test_folders_list_with_counts(clients):
    hr_c, emp = clients
    f = TemplateFolder.objects.create(name="Offer Letters")
    DocumentTemplate.objects.create(name="Appointment Letter", folder=f)
    for c in (hr_c, emp):
        resp = c.get("/api/v1/document-templates/folders")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data[0]["name"] == "Offer Letters"
        assert data[0]["template_count"] == 1


def test_create_update_delete_is_hr_only(clients):
    hr_c, emp = clients
    assert emp.post("/api/v1/document-templates", {"name": "X"}, format="json").status_code == 403

    created = hr_c.post(
        "/api/v1/document-templates",
        {"name": "Experience Letter", "body": "Dear {{name}}", "workflow_enabled": True},
        format="json",
    )
    assert created.status_code == 201
    tid = created.json()["data"]["id"]
    assert created.json()["data"]["workflowEnabled"] is True

    assert emp.patch(f"/api/v1/document-templates/{tid}", {"name": "Y"}, format="json").status_code == 403
    patched = hr_c.patch(f"/api/v1/document-templates/{tid}", {"name": "Relieving Letter"}, format="json")
    assert patched.status_code == 200
    assert patched.json()["data"]["name"] == "Relieving Letter"

    assert emp.delete(f"/api/v1/document-templates/{tid}").status_code == 403
    assert hr_c.delete(f"/api/v1/document-templates/{tid}").status_code == 200
    assert hr_c.get(f"/api/v1/document-templates/{tid}").status_code == 404


def test_list_filters_and_generate_stamp(clients):
    hr_c, emp = clients
    f = TemplateFolder.objects.create(name="Letters")
    DocumentTemplate.objects.create(name="Appointment Letter 1", folder=f, body="Hi {{name}}")
    DocumentTemplate.objects.create(name="Confirmation Letter", folder=f)

    assert len(emp.get("/api/v1/document-templates").json()["data"]) == 2
    assert len(emp.get("/api/v1/document-templates?search=appointment").json()["data"]) == 1
    assert len(emp.get(f"/api/v1/document-templates?folder={f.id}").json()["data"]) == 2
    assert emp.get("/api/v1/document-templates?folder=9999").json()["data"] == []

    t = DocumentTemplate.objects.get(name="Appointment Letter 1")
    assert t.last_used_at is None
    assert emp.post(f"/api/v1/document-templates/{t.id}/generate").status_code == 403
    gen = hr_c.post(f"/api/v1/document-templates/{t.id}/generate")
    assert gen.status_code == 200
    payload = gen.json()["data"]
    assert payload["placeholders"] == ["name"]
    assert payload["body"] == "Hi {{name}}"
    t.refresh_from_db()
    assert t.last_used_at is not None
    assert hr_c.post("/api/v1/document-templates/9999/generate").status_code == 404
