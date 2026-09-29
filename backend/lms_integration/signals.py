"""Employee and onboarding lifecycle -> outbound LMS events.

Signals rather than calls at each write site because employees change in many
places (directory edits, roster import, exits, org changes, onboarding
activation) and every one of them must reach the LMS; a hook here cannot be
forgotten by the next write path. Bulk `QuerySet.update()` bypasses signals —
the reconciliation run is what catches anything that slips through that way.

The handlers run inside the caller's transaction (the outbox row commits or
rolls back with the employee change) but inside their own savepoint and a
broad except: a bug here must never fail the HR transaction itself."""

import logging

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from employees.models import Department, Employee
from lms_integration import events
from lms_integration.models import LmsIdentityLink

logger = logging.getLogger(__name__)


@receiver(pre_save, sender=Employee, dispatch_uid="lms_employee_pre_save")
def _remember_tracked_fields(sender, instance, raw=False, **kwargs):
    if raw or not events.enabled():
        return
    instance._lms_before = None
    if instance.pk:
        previous = Employee.objects.filter(pk=instance.pk).first()
        if previous is not None:
            instance._lms_before = events.tracked_values(previous)


@receiver(post_save, sender=Employee, dispatch_uid="lms_employee_post_save")
def _queue_employee_events(sender, instance, created, raw=False, **kwargs):
    if raw or not events.enabled():
        return
    before = None if created else getattr(instance, "_lms_before", None)
    try:
        with transaction.atomic():
            to_send = events.events_for_change(instance, before)
            for event_type in to_send:
                if event_type == events.EMPLOYEE_CREATED:
                    events.provision(instance)
                else:
                    events.enqueue(instance, event_type)
    except Exception:  # noqa: BLE001 — never fail the HR write (see module docstring)
        logger.exception("LMS: could not queue events for employee %s", instance.pk)
    finally:
        instance._lms_before = events.tracked_values(instance)


@receiver(pre_save, sender=Department, dispatch_uid="lms_department_pre_save")
def _remember_department(sender, instance, raw=False, **kwargs):
    if raw or not events.enabled():
        return
    instance._lms_before = (
        Department.objects.filter(pk=instance.pk).values_list("name", "parent_id").first()
        if instance.pk
        else None
    )


@receiver(post_save, sender=Department, dispatch_uid="lms_department_post_save")
def _queue_department_change(sender, instance, created, raw=False, **kwargs):
    """A renamed or moved department changes the department path of everyone
    in it and below it, and with it the LMS training they must complete."""
    if raw or created or not events.enabled():
        return
    before = getattr(instance, "_lms_before", None)
    if before is None or before == (instance.name, instance.parent_id):
        return
    try:
        with transaction.atomic():
            subtree, frontier = {instance.pk}, {instance.pk}
            while frontier:
                frontier = (
                    set(
                        Department.objects.filter(parent_id__in=frontier).values_list(
                            "pk", flat=True
                        )
                    )
                    - subtree
                )
                subtree |= frontier
            linked = Employee.objects.filter(
                department_id__in=subtree, lms_link__isnull=False
            ).select_related("department", "manager", "user")
            for employee in linked:
                events.enqueue(employee, events.EMPLOYEE_UPDATED)
    except Exception:  # noqa: BLE001
        logger.exception("LMS: could not queue events for department %s", instance.pk)
    finally:
        instance._lms_before = (instance.name, instance.parent_id)


def _connect_onboarding():
    try:
        from onboarding.models import OnboardingProfile
    except ImportError:  # onboarding app not installed
        return

    @receiver(
        pre_save, sender=OnboardingProfile, dispatch_uid="lms_onboarding_pre_save", weak=False
    )
    def _remember_stage(sender, instance, raw=False, **kwargs):
        if raw or not events.enabled():
            return
        instance._lms_stage_before = (
            OnboardingProfile.objects.filter(pk=instance.pk).values_list("stage", flat=True).first()
            if instance.pk
            else None
        )

    @receiver(
        post_save, sender=OnboardingProfile, dispatch_uid="lms_onboarding_post_save", weak=False
    )
    def _queue_stage_change(sender, instance, raw=False, **kwargs):
        """ONBOARDING_STAGE_CHANGED lets the LMS assign the onboarding learning
        path (Implementation plan P2, UAT-04). Sent only for employees who
        already have (or are getting) a learner."""
        if raw or not events.enabled():
            return
        before = getattr(instance, "_lms_stage_before", None)
        if before == instance.stage:
            return
        try:
            with transaction.atomic():
                employee = instance.employee
                if not LmsIdentityLink.objects.filter(employee=employee).exists():
                    return
                events.enqueue(
                    employee,
                    events.ONBOARDING_STAGE_CHANGED,
                    extra={"onboarding": {"previous_stage": before, "stage": instance.stage}},
                )
        except Exception:  # noqa: BLE001
            logger.exception("LMS: could not queue onboarding stage for profile %s", instance.pk)
        finally:
            instance._lms_stage_before = instance.stage


_connect_onboarding()
