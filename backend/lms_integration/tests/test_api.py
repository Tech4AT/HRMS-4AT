"""HRMS-facing API: RBAC scoping, admin operations, SSO and reconciliation."""

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.fictional_org import FictionalOrg
from core.testing import assert_module_conforms
from lms_integration import sso
from lms_integration.conformance import ENDPOINT
from lms_integration.models import (
    EmployeeCertification,
    IntegrationEvent,
    LearningEnrollment,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
)
from lms_integration.reconcile import reconcile
from lms_integration.tests.helpers import LMS_SETTINGS, FakeLms

pytestmark = pytest.mark.django_db

BASE = "/api/v1/integrations/lms"


@pytest.fixture
def org():
    # Built with the integration off, so the fictional org starts unlinked.
    with override_settings(**{**LMS_SETTINGS, "LMS_INTEGRATION_ENABLED": False}):
        yield FictionalOrg.build()


def as_(org, key):
    client = APIClient()
    client.force_authenticate(org.people[key].user)
    return client


def enrol(employee, course_id="C1", **values):
    return LearningEnrollment.objects.create(
        employee=employee,
        course_id=course_id,
        title="Course",
        source_occurred_at=timezone.now(),
        **values,
    )


def test_certification_list_conforms_to_rbac():
    assert_module_conforms(ENDPOINT)


def test_employee_reads_own_learning_but_not_a_colleagues(org):
    enrol(org.people["eli"], mandatory=True)
    eli = as_(org, "eli")
    r = eli.get(f"{BASE}/learners/me/summary")
    assert r.status_code == 200, r.content
    assert r.json()["data"]["mandatory"]["total"] == 1
    assert eli.get(f"{BASE}/learners/{org.people['eli'].pk}/courses").status_code == 200
    assert eli.get(f"{BASE}/learners/{org.people['eve'].pk}/courses").status_code == 403
    assert eli.get(f"{BASE}/learners/{org.people['eve'].pk}/summary").status_code == 403


def test_manager_sees_direct_reports_hr_sees_everyone(org):
    for key in ("eli", "sam"):
        enrol(org.people[key])
    maya = as_(org, "maya")
    assert maya.get(f"{BASE}/learners/{org.people['eli'].pk}/courses").status_code == 200
    assert maya.get(f"{BASE}/learners/{org.people['sam'].pk}/courses").status_code == 403
    rows = maya.get(f"{BASE}/enrollments/").json()["data"]
    assert {r["employee"] for r in rows} == {org.people["eli"].pk}

    hana = as_(org, "hana")
    assert hana.get(f"{BASE}/learners/{org.people['sam'].pk}/courses").status_code == 200
    overview = hana.get(f"{BASE}/compliance").json()["data"]
    assert overview["courses"]["assigned"] == 2


def test_admin_endpoints_are_hr_only(org):
    eli = as_(org, "eli")
    for method, url in [
        ("get", f"{BASE}/health"),
        ("get", f"{BASE}/sync-jobs"),
        ("get", f"{BASE}/learners"),
        ("post", f"{BASE}/reconcile"),
        ("post", f"{BASE}/learners"),
    ]:
        assert getattr(eli, method)(url, {}, format="json").status_code == 403, url
    hana = as_(org, "hana")
    r = hana.get(f"{BASE}/health")
    assert r.status_code == 200
    assert r.json()["data"]["config"]["enabled"] is False


@override_settings(**LMS_SETTINGS)
def test_manual_link_and_conflict_protection(org):
    hana = as_(org, "hana")
    eli, eve = org.people["eli"], org.people["eve"]
    r = hana.post(f"{BASE}/learners", {"employeeId": eli.pk, "learnerId": "L-9"}, format="json")
    assert r.status_code == 201, r.content
    assert LmsIdentityLink.objects.get(employee=eli).status == LinkStatus.LINKED
    assert AuditLog.objects.filter(action="LmsIdentityLink.linked").exists()

    r = hana.post(f"{BASE}/learners", {"employeeId": eve.pk, "learnerId": "L-9"}, format="json")
    assert r.status_code == 400
    assert not LmsIdentityLink.objects.filter(employee=eve, learner_id="L-9").exists()

    r = hana.post(f"{BASE}/learners", {"employeeId": eve.pk}, format="json")
    assert r.status_code == 202
    assert IntegrationEvent.objects.filter(employee=eve, event_type="EMPLOYEE_CREATED").count() == 1
    r = hana.post(f"{BASE}/learners", {"employeeId": eve.pk}, format="json")
    assert r.json()["data"]["alreadyLinked"] is True


@override_settings(**LMS_SETTINGS)
def test_sync_job_detail_and_retry(org):
    hana = as_(org, "hana")
    eli = org.people["eli"]
    hana.post(f"{BASE}/learners", {"employeeId": eli.pk}, format="json")
    event = IntegrationEvent.objects.get(employee=eli)
    IntegrationEvent.objects.filter(pk=event.pk).update(status=SyncStatus.FAILED, last_error="boom")

    r = hana.get(f"{BASE}/sync-jobs", {"status": "FAILED"})
    assert r.json()["data"]["total"] == 1
    r = hana.get(f"{BASE}/sync-jobs/{event.event_id}")
    assert r.status_code == 200 and r.json()["data"]["payload"]["eventType"] == "EMPLOYEE_CREATED"
    r = hana.post(f"{BASE}/sync-jobs/{event.pk}/retry")
    assert r.status_code == 200
    event.refresh_from_db()
    assert event.status == SyncStatus.PENDING


@override_settings(**LMS_SETTINGS)
def test_sso_launch_token(org):
    eli = as_(org, "eli")
    r = eli.post(f"{BASE}/sso/launch", {"target": "/student/courses"}, format="json")
    assert r.status_code == 200, r.content
    data = r.json()["data"]
    assert data["launchUrl"] == LMS_SETTINGS["LMS_SSO_LAUNCH_URL"]
    claims = sso.decode(data["token"])
    assert claims["sub"] == str(org.people["eli"].pk)
    assert claims["target"] == "/student/courses"
    assert claims["exp"] - claims["iat"] <= 60

    # No open redirects.
    r = eli.post(f"{BASE}/sso/launch", {"target": "https://evil.example/x"}, format="json")
    assert "target" not in sso.decode(r.json()["data"]["token"])


def test_sso_not_configured_and_exited(org):
    eli = as_(org, "eli")
    with override_settings(LMS_SSO_SECRET=""):
        assert eli.post(f"{BASE}/sso/launch", {}, format="json").status_code == 503
    with override_settings(**LMS_SETTINGS):
        employee = org.people["eli"]
        employee.status = "exited"
        employee.save()
        assert eli.post(f"{BASE}/sso/launch", {}, format="json").status_code == 403


@override_settings(**LMS_SETTINGS)
def test_reconciliation_reports_and_fixes(org):  # UAT-12
    sam = org.people["sam"]
    LmsIdentityLink.objects.create(employee=sam, learner_id="L-sam", status=LinkStatus.LINKED)
    sam.status = "exited"
    sam.save()
    IntegrationEvent.objects.all().delete()  # pretend the exit event was lost

    run = reconcile(provision=False, client=FakeLms())
    counts = run.summary["counts"]
    assert counts["unlinked_active"] == len(org.people) - 1
    assert counts["exited_with_access"] == 1
    assert not IntegrationEvent.objects.exists()  # report only

    run = reconcile(provision=True, client=FakeLms())
    assert run.summary["actions"] == {"provisioned": len(org.people) - 1, "deactivations_queued": 1}
    assert (
        IntegrationEvent.objects.filter(employee=sam, event_type="EMPLOYEE_STATUS_CHANGED").count()
        == 1
    )
    # Running it again queues nothing new.
    run = reconcile(provision=True, client=FakeLms())
    assert run.summary["actions"] == {"provisioned": 0, "deactivations_queued": 0}


@override_settings(**LMS_SETTINGS)
def test_reconcile_endpoint(org):
    hana = as_(org, "hana")
    r = hana.post(f"{BASE}/reconcile", {"provision": False}, format="json")
    assert r.status_code == 201
    run_id = r.json()["data"]["id"]
    assert hana.get(f"{BASE}/reconcile/{run_id}").json()["data"]["findings"]


def test_expiring_certifications_on_dashboard(org):
    EmployeeCertification.objects.create(
        employee=org.people["eve"],
        certification_id="C",
        name="First Aid",
        expires_at=timezone.now() + timezone.timedelta(days=5),
        source_occurred_at=timezone.now(),
    )
    data = as_(org, "hana").get(f"{BASE}/compliance").json()["data"]
    assert [c["name"] for c in data["expiringCertifications"]] == ["First Aid"]
    assert data["expiringCertifications"][0]["status"] == "expiring"
    # Eli (self scope) does not see Eve's certificate.
    assert as_(org, "eli").get(f"{BASE}/compliance").json()["data"]["expiringCertifications"] == []
