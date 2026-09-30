"""Employee Documents verification workflow: pending-verification listing
(scope-filtered, org docs excluded), verify/reject (HR/manager-in-scope only,
reason required, owner notified on reject), nudge (owner notified), and the
expiring-days filter."""

import uuid
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Permission, User, UserPermissionOverride
from documents.models import Document
from employees.models import Employee
from notifications.models import Notification


def _user(email, **kw):
    return User.objects.create_user(username=email, email=email, password="Verify@12345", **kw)


def _grant_all(user, code):
    UserPermissionOverride.objects.create(
        user=user, permission=Permission.objects.get(code=code), scope_tier="all", is_granted=True
    )


def _emp_doc(owner_emp, uploader, **kw):
    args = dict(
        entity_type="employee_document",
        entity_id=str(owner_emp.id),
        employee=owner_emp,
        file=SimpleUploadedFile("id.pdf", b"id-bytes"),
        original_name="id.pdf",
        original_filename="id.pdf",
        size=8,
        uploaded_by=uploader,
    )
    args.update(kw)
    return Document.objects.create(**args)


def _setup():
    hr = _user("v_hr@x.com", is_superuser=True)
    u1, u2 = _user("v1@x.com"), _user("v2@x.com")
    e1 = Employee.objects.create(user=u1, employee_code="V1", first_name="Vera")
    e2 = Employee.objects.create(user=u2, employee_code="V2", first_name="Walt")
    return hr, u1, u2, e1, e2


def _ids(client, url):
    return {str(d["id"]) for d in client.get(url).json()["data"]}


@pytest.mark.django_db
def test_pending_verification_lists_own_for_employee_all_for_hr():
    hr, u1, u2, e1, e2 = _setup()
    d1, d2 = _emp_doc(e1, u1), _emp_doc(e2, u2)
    verified = _emp_doc(e1, u1, verification_status=Document.VERIFICATION_VERIFIED)
    org = Document.objects.create(
        entity_type="organization_document", entity_id="org",
        file=SimpleUploadedFile("o.pdf", b"o"), original_name="o.pdf", original_filename="o.pdf",
        size=1, uploaded_by=hr, audience=Document.AUDIENCE_ALL_EMPLOYEES,
    )

    c1 = APIClient(); c1.force_authenticate(u1)
    assert _ids(c1, "/api/v1/documents/pending-verification") == {str(d1.id)}  # own only

    chr = APIClient(); chr.force_authenticate(hr)
    seen = _ids(chr, "/api/v1/documents/pending-verification")
    assert {str(d1.id), str(d2.id)} <= seen  # every employee's pending docs
    assert str(verified.id) not in seen and str(org.id) not in seen  # verified + org docs excluded


@pytest.mark.django_db
def test_verify_hr_ok_manager_scope_ok_plain_employee_forbidden():
    hr, u1, u2, e1, e2 = _setup()
    doc = _emp_doc(e1, u1, rejection_reason="old")

    c1 = APIClient(); c1.force_authenticate(u1)
    assert c1.post(f"/api/v1/documents/{doc.id}/verify").status_code == 403  # owner cannot self-verify

    mgr = _user("v_mgr@x.com")
    Employee.objects.create(user=mgr, employee_code="VM")
    _grant_all(mgr, "employees.read")  # oversight of everyone => manager-like
    cm = APIClient(); cm.force_authenticate(mgr)
    res = cm.post(f"/api/v1/documents/{doc.id}/verify")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["verificationStatus"] == "verified" and data["rejectionReason"] == ""
    doc.refresh_from_db()
    assert doc.verified_by_id == mgr.id and doc.verified_at is not None

    chr = APIClient(); chr.force_authenticate(hr)
    assert chr.post(f"/api/v1/documents/{uuid.uuid4()}/verify").status_code == 404


@pytest.mark.django_db
def test_reject_needs_reason_and_notifies_owner():
    hr, u1, u2, e1, e2 = _setup()
    doc = _emp_doc(e1, u1)

    chr = APIClient(); chr.force_authenticate(hr)
    assert chr.post(f"/api/v1/documents/{doc.id}/reject", {}, format="json").status_code == 400

    before = Notification.objects.count()
    res = chr.post(f"/api/v1/documents/{doc.id}/reject", {"reason": "Blurry scan"}, format="json")
    assert res.status_code == 200
    assert res.json()["data"]["verificationStatus"] == "rejected"
    doc.refresh_from_db()
    assert doc.rejection_reason == "Blurry scan" and doc.verified_by_id == hr.id
    assert Notification.objects.count() == before + 1  # the owner (u1) notified
    assert Notification.objects.latest("id").user_id == u1.id

    c2 = APIClient(); c2.force_authenticate(u2)
    assert c2.post(f"/api/v1/documents/{doc.id}/reject", {"reason": "x"}, format="json").status_code == 403


@pytest.mark.django_db
def test_nudge_notifies_owner_and_gates_on_verifier():
    hr, u1, u2, e1, e2 = _setup()
    doc = _emp_doc(e1, u1)

    c1 = APIClient(); c1.force_authenticate(u1)
    assert c1.post(f"/api/v1/documents/{doc.id}/nudge").status_code == 403  # plain employee cannot nudge

    chr = APIClient(); chr.force_authenticate(hr)
    before = Notification.objects.count()
    res = chr.post(f"/api/v1/documents/{doc.id}/nudge")
    assert res.status_code == 200 and res.json()["data"] == {"notified": 1}
    assert Notification.objects.count() == before + 1
    assert Notification.objects.latest("id").user_id == u1.id

    ownerless = Document.objects.create(
        entity_type="employee_document", entity_id="999",
        file=SimpleUploadedFile("x.pdf", b"x"), original_name="x.pdf", original_filename="x.pdf",
        size=1, uploaded_by=hr,
    )
    assert chr.post(f"/api/v1/documents/{ownerless.id}/nudge").status_code == 400


@pytest.mark.django_db
def test_expiring_days_filter_and_scope():
    hr, u1, u2, e1, e2 = _setup()
    today = timezone.localdate()
    soon = _emp_doc(e1, u1, expiry_date=today + timedelta(days=10))
    later_own = _emp_doc(e1, u1, expiry_date=today + timedelta(days=60))  # u1's own, for the days boundary
    later = _emp_doc(e2, u2, expiry_date=today + timedelta(days=60))       # e2's, for the scope check below
    no_expiry = _emp_doc(e1, u1)

    c1 = APIClient(); c1.force_authenticate(u1)
    assert c1.get("/api/v1/documents/expiring?days=nope").status_code == 400
    default_ids = _ids(c1, "/api/v1/documents/expiring")  # days=30
    assert str(soon.id) in default_ids and str(no_expiry.id) not in default_ids
    assert str(later_own.id) not in default_ids  # beyond 30 days
    assert str(later_own.id) in _ids(c1, "/api/v1/documents/expiring?days=90")  # widening the window includes it

    # Scope: e1 must not see e2's expiring doc even with a wide window.
    chr = APIClient(); chr.force_authenticate(hr)
    assert str(later.id) in _ids(chr, "/api/v1/documents/expiring?days=90")
    assert str(later.id) not in _ids(c1, "/api/v1/documents/expiring?days=90")
