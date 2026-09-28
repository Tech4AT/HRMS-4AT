"""`manage.py verify_documents` — live proof the per-entity_type access matrix
gates document reads: the owning employee and matrix-permission holders get in,
a stranger is refused, and an undeclared entity_type is denied."""

from django.core.files.base import ContentFile

from accounts.models import Permission, User, UserPermissionOverride
from core.verification import VerificationCommand, Verifier
from documents.models import Document
from employees.models import Employee

PASSWORD = "Verify@12345"


def _user(email):
    return User.objects.create_user(username=email, email=email, password=PASSWORD)


class Command(VerificationCommand):
    title = "Documents primitive"

    def verify(self, v: Verifier):
        owner = _user("owner@x.com")
        employee = Employee.objects.create(user=owner, employee_code="E1")
        doc = Document.objects.create(
            entity_type="employee_document",
            entity_id=str(employee.pk),
            file=ContentFile(b"hello", name="contract.pdf"),
            original_name="contract.pdf",
            size=5,
            uploaded_by=owner,
        )
        download = f"/api/v1/documents/{doc.id}/download"
        listing = f"/api/v1/documents?entity_type=employee_document&entity_id={employee.pk}"

        v.note("--- the owning employee can read their own document")
        owner_sess = v.login("owner", "owner@x.com", PASSWORD)
        v.check("owner download is 200", owner_sess.get(download).status_code == 200)
        v.check("owner list is 200", owner_sess.get(listing).status_code == 200)

        v.note("--- a matrix-permission holder (HR) can read it")
        hr = _user("hr@x.com")
        UserPermissionOverride.objects.create(
            user=hr,
            permission=Permission.objects.get(code="employees.personal.read"),
            scope_tier="all",
            is_granted=True,
        )
        hr_sess = v.login("hr", "hr@x.com", PASSWORD)
        v.check("HR download is 200", hr_sess.get(download).status_code == 200)

        v.note("--- a stranger is refused")
        stranger = _user("stranger@x.com")
        Employee.objects.create(user=stranger, employee_code="E2")
        s_sess = v.login("stranger", "stranger@x.com", PASSWORD)
        v.check("stranger download is 403", s_sess.get(download).status_code == 403)
        v.check("stranger list is 403", s_sess.get(listing).status_code == 403)

        v.note("--- an undeclared entity_type is denied")
        r = owner_sess.get("/api/v1/documents?entity_type=mystery&entity_id=1")
        v.check("unknown entity_type is 403", r.status_code == 403, f"HTTP {r.status_code}")

        v.note("--- anonymous is refused")
        anon = v.session("anon").get(listing)
        v.check("anonymous is 401", anon.status_code == 401, f"HTTP {anon.status_code}")
