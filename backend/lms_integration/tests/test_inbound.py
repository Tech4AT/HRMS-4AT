"""LMS -> HRMS webhook: signed, idempotent, ordered by occurrence
(UAT-05..08, 10)."""

import time
from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from employees.factories import EmployeeFactory
from lms_integration.models import (
    AssessmentResult,
    EmployeeCertification,
    EmployeeSkill,
    IntegrationEvent,
    LearningEnrollment,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
)
from lms_integration.summary import learning_summary
from lms_integration.tests.helpers import LMS_SETTINGS, lms_event, signed_post

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("lms_on")]


@pytest.fixture
def lms_on():
    with override_settings(**{**LMS_SETTINGS, "LMS_INTEGRATION_ENABLED": False}):
        yield


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def employee():
    return EmployeeFactory(status="active")


def test_unsigned_or_badly_signed_calls_are_rejected(api, employee):
    envelope = lms_event("COURSE_COMPLETED", employee, {"course_id": "C1"})
    assert api.post("/api/v1/integrations/lms/events", envelope, format="json").status_code == 401
    assert signed_post(api, envelope, secret="wrong").status_code == 401
    assert (
        signed_post(api, envelope, timestamp=time.time() - 3600).status_code == 401
    )  # replay window
    assert not LearningEnrollment.objects.exists()


def test_enrolment_then_completion_shows_in_hrms(api, employee):  # UAT-05
    r = signed_post(
        api,
        lms_event(
            "LEARNING_ENROLLED",
            employee,
            {
                "course_id": "C1",
                "title": "Code of Conduct",
                "mandatory": True,
                "path_id": "P1",
                "path_name": "New joiner",
                "due_at": "2026-10-15",
            },
            occurred_at="2026-09-01T09:00:00Z",
        ),
    )
    assert r.status_code == 200, r.content
    r = signed_post(
        api,
        lms_event(
            "COURSE_COMPLETED",
            employee,
            {"course_id": "C1", "score": 92.5},
            occurred_at="2026-09-10T09:00:00Z",
        ),
    )
    assert r.status_code == 200, r.content
    row = LearningEnrollment.objects.get(employee=employee, course_id="C1")
    assert (row.status, row.progress, float(row.score), row.title) == (
        "completed",
        100,
        92.5,
        "Code of Conduct",
    )
    summary = learning_summary(employee)
    assert summary["mandatory"] == {"total": 1, "completed": 1, "outstanding": 0, "progress": 100}
    assert summary["learning_paths"][0]["progress"] == 100


def test_duplicate_event_is_acknowledged_not_reapplied(api, employee):  # UAT-10
    envelope = lms_event("COURSE_COMPLETED", employee, {"course_id": "C1", "title": "X"})
    assert signed_post(api, envelope).status_code == 200
    r = signed_post(api, envelope)
    assert r.status_code == 200 and r.json()["data"]["duplicate"] is True
    assert LearningEnrollment.objects.count() == 1
    assert IntegrationEvent.objects.filter(event_id=envelope["event_id"]).count() == 1


def test_an_older_event_arriving_late_never_overwrites_newer_state(api, employee):
    signed_post(
        api,
        lms_event(
            "COURSE_COMPLETED", employee, {"course_id": "C1"}, occurred_at="2026-09-10T00:00:00Z"
        ),
    )
    signed_post(
        api,
        lms_event(
            "LEARNING_PROGRESS",
            employee,
            {"course_id": "C1", "progress": 40},
            occurred_at="2026-09-05T00:00:00Z",
        ),
    )
    signed_post(
        api,
        lms_event(
            "LEARNING_ENROLLED", employee, {"course_id": "C1"}, occurred_at="2026-09-20T00:00:00Z"
        ),
    )
    row = LearningEnrollment.objects.get(employee=employee)
    assert row.status == "completed" and row.progress == 100


def test_assessment_result_is_projected(api, employee):  # UAT-06
    signed_post(
        api,
        lms_event(
            "ASSESSMENT_COMPLETED",
            employee,
            {
                "assessment_id": "A1",
                "title": "Java basics",
                "score": 18,
                "max_score": 20,
                "status": "passed",
            },
        ),
    )
    result = AssessmentResult.objects.get(employee=employee)
    assert (result.status, int(result.score), int(result.max_score)) == ("passed", 18, 20)


def test_certification_and_expiry(api, employee):  # UAT-07, UAT-08
    soon = (timezone.now() + timedelta(days=10)).isoformat()
    signed_post(
        api,
        lms_event(
            "CERTIFICATION_EARNED",
            employee,
            {
                "certification_id": "CERT1",
                "name": "AWS SA",
                "issued_at": "2026-01-01",
                "expires_at": soon,
            },
            occurred_at="2026-09-01T00:00:00Z",
        ),
    )
    cert = EmployeeCertification.objects.get(employee=employee)
    assert cert.name == "AWS SA" and cert.expires_at is not None
    # Inside the 30-day window HRMS flags it even before the LMS says so.
    assert learning_summary(employee)["certifications"]["expiring"] == 1

    signed_post(
        api,
        lms_event(
            "CERTIFICATION_EXPIRING",
            employee,
            {"certification_id": "CERT1"},
            occurred_at="2026-09-20T00:00:00Z",
        ),
    )
    cert.refresh_from_db()
    assert cert.status == "expiring" and cert.name == "AWS SA"


def test_skill_update(api, employee):
    signed_post(
        api,
        lms_event(
            "SKILL_UPDATED",
            employee,
            {
                "skill_id": "S1",
                "name": "Python",
                "proficiency": "Advanced",
                "evidence_refs": ["course:C1"],
            },
        ),
    )
    skill = EmployeeSkill.objects.get(employee=employee)
    assert (skill.name, skill.proficiency, skill.evidence_refs) == (
        "Python",
        "Advanced",
        ["course:C1"],
    )


def test_events_can_address_the_employee_by_learner_id(api, employee):
    LmsIdentityLink.objects.create(employee=employee, learner_id="L-77", status=LinkStatus.LINKED)
    envelope = lms_event("SKILL_UPDATED", employee, {"skill_id": "S1", "name": "SQL"})
    del envelope["employee_id"]
    envelope["learner_id"] = "L-77"
    assert signed_post(api, envelope).status_code == 200
    assert EmployeeSkill.objects.filter(employee=employee).exists()


def test_failed_event_is_visible_and_reapplied_when_resent(api, employee):
    envelope = lms_event("SKILL_UPDATED", employee, {"skill_id": "S1", "name": "Go"})
    envelope.pop("employee_id")
    envelope["learner_id"] = "L-404"
    r = signed_post(api, envelope)
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNKNOWN_LEARNER"
    assert IntegrationEvent.objects.get(event_id=envelope["event_id"]).status == SyncStatus.FAILED

    LmsIdentityLink.objects.create(employee=employee, learner_id="L-404", status=LinkStatus.LINKED)
    assert signed_post(api, envelope).status_code == 200
    event = IntegrationEvent.objects.get(event_id=envelope["event_id"])
    assert event.status == SyncStatus.SUCCEEDED and event.attempt_count == 2


def test_learner_linked_confirms_the_link_and_blocks_duplicates(api, employee):
    other = EmployeeFactory(status="active")
    r = signed_post(api, lms_event("LEARNER_LINKED", employee, {}, learner_id="L-5"))
    assert r.status_code == 200
    link = LmsIdentityLink.objects.get(employee=employee)
    assert (link.learner_id, link.status) == ("L-5", LinkStatus.LINKED)

    r = signed_post(api, lms_event("LEARNER_LINKED", other, {}, learner_id="L-5"))
    assert r.status_code == 409
    assert not LmsIdentityLink.objects.filter(employee=other, learner_id="L-5").exists()


def test_validation_errors(api, employee):
    assert signed_post(api, lms_event("COURSE_COMPLETED", employee, {})).status_code == 422
    assert signed_post(api, lms_event("SOMETHING_ELSE", employee, {})).status_code == 422
    bad = lms_event("COURSE_COMPLETED", employee, {"course_id": "C"})
    bad["occurred_at"] = "yesterday"
    assert signed_post(api, bad).status_code == 400
    missing = lms_event("COURSE_COMPLETED", employee, {"course_id": "C"})
    missing["employee_id"] = "999999"
    assert signed_post(api, missing).status_code == 422
