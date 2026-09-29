"""HTTP surface of the LMS integration, under /api/v1/integrations/lms/
(API & Event Contract §3). Success bodies are `{success, data}`.

Who can call what:
- learner reads (summary/courses/assessments/certifications/skills) and the
  compliance overview: lms.read, scope-checked against the employee
- SSO launch: lms.launch, and only ever for the caller themselves
- links, sync jobs, health, reconcile: lms.admin
- events: the LMS itself, authenticated by HMAC signature, not by a user
"""

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Min
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from core.permissions import HasPermissionCode, ScopedEmployeePermission
from core.scope import resolve_employee_scope
from employees.models import Employee
from lms_integration import dispatcher, events, inbound, reconcile, sso, summary
from lms_integration.client import LmsClient
from lms_integration.models import (
    AssessmentResult,
    EmployeeCertification,
    EmployeeSkill,
    EventDirection,
    IntegrationEvent,
    LearningEnrollment,
    LinkStatus,
    LmsIdentityLink,
    ReconciliationRun,
    SyncStatus,
)
from lms_integration.serializers import (
    AssessmentSerializer,
    CertificationSerializer,
    EnrollmentSerializer,
    EventDetailSerializer,
    EventSerializer,
    LinkRequestSerializer,
    LinkSerializer,
    ReconcileRequestSerializer,
    ReconciliationRunDetailSerializer,
    ReconciliationRunSerializer,
    SkillSerializer,
    SsoLaunchSerializer,
)


def ok(data, http_status=status.HTTP_200_OK):
    return Response({"success": True, "data": data}, status=http_status)


def _page(request, queryset, serializer_class, default_size=50):
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
        size = min(max(int(request.query_params.get("page_size", default_size)), 1), 200)
    except ValueError:
        raise ValidationError("page and page_size must be integers.") from None
    total = queryset.count()
    rows = queryset[(page - 1) * size : page * size]
    return {
        "results": serializer_class(rows, many=True).data,
        "total": total,
        "page": page,
        "page_size": size,
    }


def _numeric(value):
    if not str(value).isdigit():
        raise NotFound("No such employee.")
    return int(value)


def employee_in_scope(request, employee_id, permission_code) -> Employee:
    """`me` or an HRMS employee id, checked against the caller's scope for
    `permission_code`. Out of scope is a 403, not a 404, like everywhere else."""
    if employee_id == "me":
        employee = getattr(request.user, "employee", None)
        if employee is None:
            raise NotFound("This account has no employee record.")
    else:
        if not str(employee_id).isdigit():
            raise NotFound("No such employee.")
        employee = get_object_or_404(Employee, pk=employee_id)
    if not resolve_employee_scope(request.user, permission_code).filter(pk=employee.pk).exists():
        raise PermissionDenied("You do not have access to this employee's learning records.")
    return employee


# --------------------------------------------------------------- learner reads


class _LearnerReadView(APIView):
    permission_classes = [HasPermissionCode]
    required_permission = "lms.read"


class LearnerSummaryView(_LearnerReadView):
    def get(self, request, employee_id):
        employee = employee_in_scope(request, employee_id, self.required_permission)
        return ok({"employee_id": employee.pk, **summary.learning_summary(employee)})


def _learner_list_view(model, serializer_class, order):
    class View(_LearnerReadView):
        def get(self, request, employee_id):
            employee = employee_in_scope(request, employee_id, self.required_permission)
            rows = model.objects.filter(employee=employee).order_by(*order)
            return ok(serializer_class(rows, many=True).data)

    View.__name__ = f"Learner{model.__name__}ListView"
    View.__qualname__ = View.__name__
    return View


LearnerCoursesView = _learner_list_view(
    LearningEnrollment, EnrollmentSerializer, ("-mandatory", "status", "due_at", "id")
)
LearnerAssessmentsView = _learner_list_view(
    AssessmentResult, AssessmentSerializer, ("-completed_at", "id")
)
LearnerCertificationsView = _learner_list_view(
    EmployeeCertification, CertificationSerializer, ("expires_at", "id")
)
LearnerSkillsView = _learner_list_view(EmployeeSkill, SkillSerializer, ("name",))


class _ScopedProjectionViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Team / org-wide lists (manager and HR views), scoped like every other
    employee-keyed list in HRMS. Optional ?employee=<id> filter."""

    permission_classes = [ScopedEmployeePermission]
    required_permission = "lms.read"
    model = None

    def get_queryset(self):
        queryset = self.model.objects.select_related("employee")
        if self.action == "list":
            queryset = queryset.filter(
                employee_id__in=resolve_employee_scope(self.request.user, self.required_permission)
            )
            employee = self.request.query_params.get("employee")
            if employee and employee.isdigit():
                queryset = queryset.filter(employee_id=employee)
        return queryset

    def list(self, request, *args, **kwargs):
        return ok(self.get_serializer(self.get_queryset(), many=True).data)

    def retrieve(self, request, *args, **kwargs):
        return ok(self.get_serializer(self.get_object()).data)


class EnrollmentViewSet(_ScopedProjectionViewSet):
    model = LearningEnrollment
    serializer_class = EnrollmentSerializer


class CertificationViewSet(_ScopedProjectionViewSet):
    model = EmployeeCertification
    serializer_class = CertificationSerializer


class ComplianceView(APIView):
    """HR Dashboard -> Learning, over the caller's lms.read scope."""

    permission_classes = [HasPermissionCode]
    required_permission = "lms.read"

    def get(self, request):
        scope = resolve_employee_scope(request.user, self.required_permission)
        return ok(summary.compliance_overview(scope))


# --------------------------------------------------------------- SSO


class SsoLaunchView(APIView):
    permission_classes = [HasPermissionCode]
    required_permission = "lms.launch"

    def post(self, request):
        employee = getattr(request.user, "employee", None)
        if employee is None:
            raise PermissionDenied("Only employees can open the LMS.")
        if employee.status == "exited":
            raise PermissionDenied("LMS access ends when employment ends.")
        body = SsoLaunchSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            data = sso.launch(employee, body.validated_data.get("target"))
        except sso.SsoNotConfigured as exc:
            return Response(
                {
                    "success": False,
                    "error": {"code": "LMS_SSO_NOT_CONFIGURED", "message": str(exc)},
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        write_audit(request.user, "lms.sso_launched", "Employee", employee.pk, {"jti": data["jti"]})
        return ok(data)


# --------------------------------------------------------------- admin


class _AdminView(APIView):
    permission_classes = [HasPermissionCode]
    required_permission = "lms.admin"


class LearnersView(_AdminView):
    """GET  list identity links (?status=, ?q=)
    POST {employee_id, learner_id?}: link to a known learner, or provision."""

    def get(self, request):
        queryset = LmsIdentityLink.objects.select_related("employee").order_by(
            "employee__employee_code"
        )
        link_status = request.query_params.get("status")
        if link_status:
            queryset = queryset.filter(status=link_status)
        q = request.query_params.get("q")
        if q:
            queryset = (
                queryset.filter(employee__employee_code__icontains=q)
                | queryset.filter(employee__first_name__icontains=q)
                | queryset.filter(learner_id=q)
            )
        return ok(_page(request, queryset, LinkSerializer))

    def post(self, request):
        body = LinkRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        employee = get_object_or_404(Employee, pk=body.validated_data["employee_id"])
        learner_id = (body.validated_data.get("learner_id") or "").strip()

        with transaction.atomic():
            if learner_id:
                taken = (
                    LmsIdentityLink.objects.filter(learner_id=learner_id)
                    .exclude(employee=employee)
                    .first()
                )
                if taken:
                    owner = taken.employee_id
                    message = f"Learner {learner_id} is already linked to employee {owner}."
                    raise ValidationError({"learner_id": [message]})
                link, _ = LmsIdentityLink.objects.select_for_update().get_or_create(
                    employee=employee
                )
                previous = {"learner_id": link.learner_id, "status": link.status}
                link.learner_id = learner_id
                link.status = (
                    LinkStatus.DEACTIVATED if employee.status == "exited" else LinkStatus.LINKED
                )
                link.last_error = ""
                if not link.linked_at:
                    link.linked_at = timezone.now()
                link.save()
                # Push the current snapshot so the LMS learner agrees with HRMS.
                event = events.enqueue(employee, events.EMPLOYEE_UPDATED, actor=request.user)
                write_audit(
                    request.user,
                    "LmsIdentityLink.linked",
                    "LmsIdentityLink",
                    link.pk,
                    {
                        "before": previous,
                        "after": {"learner_id": learner_id, "status": link.status},
                    },
                )
                return ok(
                    {"link": LinkSerializer(link).data, "event_id": event.event_id},
                    status.HTTP_201_CREATED,
                )

            if employee.status not in events.PROVISIONED_STATUSES:
                raise ValidationError(
                    {
                        "employee_id": [
                            f"Employees in status {employee.status!r} are not provisioned."
                        ]
                    }
                )
            event = events.provision(employee, actor=request.user)
            link = LmsIdentityLink.objects.get(employee=employee)
            if event is None:
                return ok(
                    {"link": LinkSerializer(link).data, "event_id": None, "already_linked": True}
                )
            write_audit(
                request.user, "LmsIdentityLink.provision_requested", "LmsIdentityLink", link.pk
            )
            return ok(
                {"link": LinkSerializer(link).data, "event_id": event.event_id},
                status.HTTP_202_ACCEPTED,
            )


class LearnerResyncView(_AdminView):
    """PATCH learners/<employeeId>: push the employee's current allowed fields
    to the LMS again (Contract §3 "Sync allowed fields")."""

    def patch(self, request, employee_id):
        employee = get_object_or_404(Employee, pk=_numeric(employee_id))
        link = LmsIdentityLink.objects.filter(employee=employee).first()
        if link is None:
            raise ValidationError(
                {"employee_id": ["Employee has no LMS link yet; provision first."]}
            )
        if link.status == LinkStatus.CONFLICT:
            raise ValidationError({"employee_id": ["Resolve the link conflict first."]})
        event_type = (
            events.EMPLOYEE_STATUS_CHANGED
            if employee.status == "exited"
            else events.EMPLOYEE_UPDATED
        )
        event = events.enqueue(employee, event_type, actor=request.user)
        write_audit(
            request.user,
            "LmsIdentityLink.resync_requested",
            "LmsIdentityLink",
            link.pk,
            {"event_id": event.event_id},
        )
        return ok({"event_id": event.event_id, "event_type": event_type}, status.HTTP_202_ACCEPTED)


class LinkResetView(_AdminView):
    """Resolve a conflict: clear the learner id so the next provisioning or a
    manual link decides it afresh."""

    def post(self, request, employee_id):
        link = get_object_or_404(LmsIdentityLink, employee_id=_numeric(employee_id))
        before = {"learner_id": link.learner_id, "status": link.status}
        link.learner_id = None
        link.status = LinkStatus.PENDING
        link.last_error = ""
        link.save()
        write_audit(
            request.user, "LmsIdentityLink.reset", "LmsIdentityLink", link.pk, {"before": before}
        )
        return ok(LinkSerializer(link).data)


class SyncJobsView(_AdminView):
    def get(self, request):
        queryset = IntegrationEvent.objects.select_related("employee")
        params = request.query_params
        for field in ("status", "direction", "event_type"):
            if params.get(field):
                queryset = queryset.filter(**{field: params[field]})
        if params.get("employee") and params["employee"].isdigit():
            queryset = queryset.filter(employee_id=params["employee"])
        return ok(_page(request, queryset, EventSerializer))


def _event(job_id):
    lookup = {"pk": job_id} if str(job_id).isdigit() else {"event_id": job_id}
    return get_object_or_404(IntegrationEvent.objects.select_related("employee"), **lookup)


class SyncJobDetailView(_AdminView):
    def get(self, request, job_id):
        return ok(EventDetailSerializer(_event(job_id)).data)


class SyncJobRetryView(_AdminView):
    def post(self, request, job_id):
        event = _event(job_id)
        if event.direction != EventDirection.OUTBOUND:
            raise ValidationError("Inbound events are retried by the LMS re-sending them.")
        if event.status not in (SyncStatus.FAILED, SyncStatus.RETRYING):
            raise ValidationError(
                f"Only FAILED or RETRYING events can be retried (this one is {event.status})."
            )
        dispatcher.retry(event, actor=request.user)
        return ok(EventSerializer(event).data)


class HealthView(_AdminView):
    """Integration Admin -> Sync Health."""

    def get(self, request):
        by = {
            (row["direction"], row["status"]): row["n"]
            for row in IntegrationEvent.objects.values("direction", "status").annotate(
                n=Count("id")
            )
        }
        outbound = IntegrationEvent.objects.filter(direction=EventDirection.OUTBOUND)
        inbound_qs = IntegrationEvent.objects.filter(direction=EventDirection.INBOUND)
        links = dict(LmsIdentityLink.objects.values_list("status").annotate(n=Count("id")))
        last_run = ReconciliationRun.objects.first()
        return ok(
            {
                "config": {
                    "enabled": settings.LMS_INTEGRATION_ENABLED,
                    "lms_configured": LmsClient().configured,
                    "inbound_configured": bool(settings.LMS_INBOUND_SECRET),
                    "sso_configured": bool(settings.LMS_SSO_SECRET and settings.LMS_SSO_LAUNCH_URL),
                    "base_url": settings.LMS_BASE_URL or None,
                },
                "outbound": {
                    s.value: by.get((EventDirection.OUTBOUND, s.value), 0) for s in SyncStatus
                }
                | {
                    "last_success_at": outbound.filter(status=SyncStatus.SUCCEEDED).aggregate(
                        t=Max("processed_at")
                    )["t"],
                    "oldest_pending_at": outbound.filter(
                        status__in=(SyncStatus.PENDING, SyncStatus.RETRYING)
                    ).aggregate(t=Min("created_at"))["t"],
                },
                "inbound": {
                    s.value: by.get((EventDirection.INBOUND, s.value), 0) for s in SyncStatus
                }
                | {"last_received_at": inbound_qs.aggregate(t=Max("created_at"))["t"]},
                "links": {s.value: links.get(s.value, 0) for s in LinkStatus},
                "unlinked_active": Employee.objects.filter(status__in=events.PROVISIONED_STATUSES)
                .exclude(
                    lms_link__status__in=(
                        LinkStatus.PENDING,
                        LinkStatus.LINKED,
                        LinkStatus.CONFLICT,
                    )
                )
                .count(),
                "last_reconciliation": (
                    ReconciliationRunSerializer(last_run).data if last_run else None
                ),
            }
        )


class ReconcileView(_AdminView):
    def get(self, request):
        return ok(
            _page(
                request,
                ReconciliationRun.objects.all(),
                ReconciliationRunSerializer,
                default_size=20,
            )
        )

    def post(self, request):
        body = ReconcileRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        run = reconcile.reconcile(actor=request.user, provision=body.validated_data["provision"])
        return ok(ReconciliationRunDetailSerializer(run).data, status.HTTP_201_CREATED)


class ReconcileDetailView(_AdminView):
    def get(self, request, run_id):
        return ok(
            ReconciliationRunDetailSerializer(get_object_or_404(ReconciliationRun, pk=run_id)).data
        )


# --------------------------------------------------------------- LMS -> HRMS


class InboundEventsView(APIView):
    """The LMS's webhook. Authenticated by HMAC signature over the raw body
    (inbound.receive), so no user authentication and no body parsing here."""

    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]

    def post(self, request):
        http_status, body = inbound.receive(request.body, request.headers)
        return Response(body, status=http_status)
