"""HRMS -> LMS: lifecycle events are queued once, in order, and delivered
with retries, without ever failing the HR write (UAT-01..04, 09..11)."""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import Designation
from lms_integration import dispatcher, events
from lms_integration.models import (
    IntegrationDelivery,
    IntegrationEvent,
    LinkStatus,
    LmsIdentityLink,
    SyncStatus,
)
from lms_integration.tests.helpers import (
    LMS_SETTINGS,
    FakeLms,
    http_error,
    ok_response,
    unavailable,
)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("lms_on")]


@pytest.fixture
def lms_on():
    with override_settings(**LMS_SETTINGS):
        yield


def outbound(employee=None):
    qs = IntegrationEvent.objects.filter(direction="outbound").order_by("id")
    return list(qs.filter(employee=employee) if employee else qs)


def types(employee):
    return [e.event_type for e in outbound(employee)]


def test_new_active_employee_is_provisioned_exactly_once():  # UAT-01
    employee = EmployeeFactory(status="active")
    assert types(employee) == ["EMPLOYEE_CREATED"]
    link = LmsIdentityLink.objects.get(employee=employee)
    assert link.status == LinkStatus.PENDING and link.learner_id is None

    employee.save()  # nothing tracked changed
    events.provision(employee)  # a second explicit provisioning is a no-op
    assert types(employee) == ["EMPLOYEE_CREATED"]


def test_payload_is_the_canonical_minimised_snapshot():
    manager = EmployeeFactory(status="active")
    employee = EmployeeFactory(
        status="active", manager=manager, phone="+91 99999", first_name="Asha"
    )
    payload = outbound(employee)[0].payload
    assert payload["event_type"] == "EMPLOYEE_CREATED"
    assert payload["event_id"].startswith("evt_") and payload["correlation_id"].startswith("corr_")
    snapshot = payload["employee"]
    assert snapshot["employee_id"] == str(employee.pk)
    assert snapshot["employee_code"] == employee.employee_code
    assert snapshot["employment_status"] == "ACTIVE"
    assert snapshot["manager_employee_id"] == str(manager.pk)
    # Contract §4: personal data never leaves HRMS.
    flat = str(payload)
    assert "+91 99999" not in flat and "phone" not in snapshot and "dob" not in snapshot


def test_disabled_integration_queues_nothing():
    with override_settings(LMS_INTEGRATION_ENABLED=False):
        employee = EmployeeFactory(status="active")
    assert outbound(employee) == []


def test_pre_onboarding_hire_is_provisioned_when_activated():
    employee = EmployeeFactory(status="pre_onboarding")
    assert types(employee) == []
    employee.status = "active"
    employee.save()
    assert types(employee) == ["EMPLOYEE_CREATED"]


def test_department_change_syncs_profile():  # UAT-02
    employee = EmployeeFactory(status="active")
    employee.department = DepartmentFactory(name="Platform")
    employee.save()
    assert types(employee) == ["EMPLOYEE_CREATED", "EMPLOYEE_UPDATED"]
    assert outbound(employee)[-1].payload["employee"]["department_name"] == "Platform"


def test_designation_change_raises_role_changed():  # UAT-03
    employee = EmployeeFactory(status="active")
    employee.designation = Designation.objects.create(name="Senior Engineer")
    employee.save()
    assert types(employee)[-1] == "ROLE_CHANGED"


def test_exit_raises_status_change():  # UAT-09
    employee = EmployeeFactory(status="active")
    employee.status = "exited"
    employee.date_of_exit = timezone.localdate()
    employee.save()
    assert "EMPLOYEE_STATUS_CHANGED" in types(employee)
    assert outbound(employee)[-1].payload["employee"]["employment_status"] == "EXITED"


def test_onboarding_stage_change_is_sent_for_linked_employees():  # UAT-04
    from onboarding.models import OnboardingProfile

    employee = EmployeeFactory(status="active")
    profile = OnboardingProfile.objects.create(employee=employee, stage="preboarding")
    profile.stage = "onboarding"
    profile.save()
    last = outbound(employee)[-1]
    assert last.event_type == "ONBOARDING_STAGE_CHANGED"
    assert last.payload["onboarding"] == {"previous_stage": "preboarding", "stage": "onboarding"}


def test_a_broken_hook_never_fails_the_hr_write(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("bug in the integration")

    monkeypatch.setattr(events, "events_for_change", boom)
    employee = EmployeeFactory(status="active")  # must not raise
    assert employee.pk and outbound(employee) == []


# ------------------------------------------------------------------ dispatcher


def test_delivery_links_the_learner():
    employee = EmployeeFactory(status="active")
    fake = FakeLms(ok_response(learner_id="L-100"))
    counts = dispatcher.dispatch_due(client=fake)
    assert counts["succeeded"] == 1
    event = outbound(employee)[0]
    assert event.status == SyncStatus.SUCCEEDED and event.attempt_count == 1
    link = LmsIdentityLink.objects.get(employee=employee)
    assert (link.learner_id, link.status) == ("L-100", LinkStatus.LINKED)
    assert fake.sent[0]["event_id"] == event.event_id
    assert IntegrationDelivery.objects.get(event=event).succeeded


def test_lms_outage_does_not_block_hr_and_is_retried():  # UAT-11
    employee = EmployeeFactory(status="active")
    fake = FakeLms(unavailable())
    dispatcher.dispatch_due(client=fake)
    event = outbound(employee)[0]
    assert event.status == SyncStatus.RETRYING
    assert event.next_attempt_at > timezone.now()
    assert "unreachable" in event.last_error

    # Not due yet: nothing is sent.
    dispatcher.dispatch_due(client=fake)
    assert len(fake.sent) == 1

    IntegrationEvent.objects.filter(pk=event.pk).update(
        next_attempt_at=timezone.now() - timedelta(seconds=1)
    )
    dispatcher.dispatch_due(client=fake)
    event.refresh_from_db()
    assert event.status == SyncStatus.SUCCEEDED and event.attempt_count == 2


def test_retries_give_up_after_max_attempts_and_admin_can_retry():
    employee = EmployeeFactory(status="active")
    fake = FakeLms(unavailable(), unavailable(), unavailable())
    for _ in range(3):
        IntegrationEvent.objects.update(next_attempt_at=timezone.now() - timedelta(seconds=1))
        dispatcher.dispatch_due(client=fake)
    event = outbound(employee)[0]
    assert event.status == SyncStatus.FAILED and event.attempt_count == 3

    dispatcher.retry(event)
    dispatcher.dispatch_due(client=fake)
    event.refresh_from_db()
    assert event.status == SyncStatus.SUCCEEDED


def test_client_errors_fail_without_retrying():
    employee = EmployeeFactory(status="active")
    dispatcher.dispatch_due(client=FakeLms(http_error(400, "unknown department")))
    event = outbound(employee)[0]
    assert event.status == SyncStatus.FAILED
    assert "unknown department" in LmsIdentityLink.objects.get(employee=employee).last_error


def test_duplicate_delivery_409_counts_as_success():  # UAT-10
    employee = EmployeeFactory(status="active")
    dispatcher.dispatch_due(client=FakeLms(http_error(409, "already applied")))
    assert outbound(employee)[0].status == SyncStatus.SUCCEEDED


def test_events_for_one_employee_are_delivered_in_order():
    employee = EmployeeFactory(status="active")
    employee.department = DepartmentFactory(name="Ops")
    employee.save()
    fake = FakeLms(unavailable())
    dispatcher.dispatch_due(client=fake)
    # The update must wait behind the retrying create.
    assert [p["event_type"] for p in fake.sent] == ["EMPLOYEE_CREATED"]
    assert outbound(employee)[1].status == SyncStatus.PENDING


def test_exit_delivery_deactivates_the_link():  # UAT-09
    employee = EmployeeFactory(status="active")
    dispatcher.dispatch_due(client=FakeLms())
    employee.status = "exited"
    employee.save()
    dispatcher.dispatch_due(client=FakeLms())
    assert LmsIdentityLink.objects.get(employee=employee).status == LinkStatus.DEACTIVATED

    # Rehire reuses the same learner.
    employee.status = "active"
    employee.save()
    link = LmsIdentityLink.objects.get(employee=employee)
    assert link.status == LinkStatus.LINKED
    assert types(employee)[-1] == "EMPLOYEE_CREATED"
    assert outbound(employee)[-1].payload["learner_id"] == link.learner_id


def test_a_learner_already_linked_elsewhere_is_a_conflict_not_an_overwrite():
    first = EmployeeFactory(status="active")
    second = EmployeeFactory(status="active")
    dispatcher.dispatch_due(
        client=FakeLms(ok_response(learner_id="L-1"), ok_response(learner_id="L-1"))
    )
    assert LmsIdentityLink.objects.get(employee=first).learner_id == "L-1"
    link = LmsIdentityLink.objects.get(employee=second)
    assert link.status == LinkStatus.CONFLICT and link.learner_id is None
    assert outbound(second)[0].status == SyncStatus.FAILED


def test_nothing_is_sent_when_lms_is_not_configured():
    EmployeeFactory(status="active")
    with override_settings(LMS_BASE_URL=""):
        counts = dispatcher.dispatch_due()
    assert "skipped" in counts
    assert outbound()[0].status == SyncStatus.PENDING


def test_real_day1_activation_provisions_then_moves_to_onboarding_path(monkeypatch):
    """The existing onboarding flow (onboarding.services.activate_day1) is what
    turns a preboarding hire into an LMS learner: EMPLOYEE_CREATED first, then
    ONBOARDING_STAGE_CHANGED so the LMS can assign the onboarding path."""
    from types import SimpleNamespace

    from onboarding import services
    from onboarding.models import OFFER_ACCEPTED, OnboardingProfile

    employee = EmployeeFactory(status="pre_onboarding")
    profile = OnboardingProfile.objects.create(employee=employee, stage="preboarding")
    assert types(employee) == []  # nothing is sent for a preboarding hire

    monkeypatch.setattr(
        OnboardingProfile,
        "current_offer_letter",
        property(lambda self: SimpleNamespace(status=OFFER_ACCEPTED)),
    )
    assert services.activate_day1(profile) is True

    assert types(employee) == ["EMPLOYEE_CREATED", "ONBOARDING_STAGE_CHANGED"]
    created, stage = outbound(employee)
    assert created.payload["employee"]["employment_status"] == "ACTIVE"
    assert stage.payload["onboarding"] == {"previous_stage": "preboarding", "stage": "onboarding"}


def test_snapshot_carries_the_department_path():
    parent = DepartmentFactory(name="Audit & Assurance")
    child = DepartmentFactory(name="InfoSec Audit")
    child.parent = parent
    child.save()
    employee = EmployeeFactory(status="active", department=child)
    snapshot = outbound(employee)[0].payload["employee"]
    assert snapshot["department_path"] == ["Audit & Assurance", "InfoSec Audit"]


def test_moving_a_department_updates_everyone_under_it():
    top = DepartmentFactory(name="Audit & Assurance")
    team = DepartmentFactory(name="SOX")
    employee = EmployeeFactory(status="active", department=team)
    dispatcher.dispatch_due(client=FakeLms())
    team.parent = top
    team.save()
    last = outbound(employee)[-1]
    assert last.event_type == "EMPLOYEE_UPDATED"
    assert last.payload["employee"]["department_path"] == ["Audit & Assurance", "SOX"]
