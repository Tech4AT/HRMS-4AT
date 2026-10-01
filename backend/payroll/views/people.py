"""PAY-003 payroll profile, PAY-004/005 compensation and revisions, and the
employee self-service (ESS) endpoints. Every employee-keyed endpoint is
scope-checked through core.scope.resolve_employee_scope."""

import datetime

from django.db.models import Q
from rest_framework.decorators import action

from core.scope import user_has_permission
from employees.models import Employee
from payroll import models as m
from payroll import serializers as s
from payroll.services import config as config_service
from payroll.services import outputs as output_service
from payroll.services import people as svc
from payroll.services.common import employee_card, forbidden, invalid

from .base import PayrollViewSet


def _comp_brief(comp):
    if comp is None:
        return None
    return {
        "id": str(comp.pk),
        "version_no": comp.version_no,
        "annual_ctc": str(comp.annual_ctc),
        "structure": {
            "id": str(comp.structure_id),
            "code": comp.structure.code,
            "name": comp.structure.name,
        },
        "effective_from": comp.effective_from.isoformat(),
        "effective_to": comp.effective_to.isoformat() if comp.effective_to else None,
        "status": comp.status,
        "revision_type": comp.revision_type,
        "reason": comp.reason,
        "monthly_gross": str((comp.breakup.get("totals") or {}).get("gross_monthly", "")),
        "net_take_home": str((comp.breakup.get("totals") or {}).get("net_take_home_monthly", "")),
    }


class PayrollEmployeeViewSet(PayrollViewSet):
    """/payroll/employees/: the payroll view of the Employee Directory."""

    queryset = Employee.objects.all()
    required_permission = "payroll.read"
    action_permissions = {
        "list": "payroll.read",
        "retrieve": "payroll.read",
        "profile": "payroll.write",
        "bank_statutory": "payroll.write",
        "history": "payroll.read",
    }

    def list(self, request):
        ids = self.scope_ids("payroll.read")
        qs = Employee.objects.filter(pk__in=ids).select_related(
            "user", "department", "designation", "location", "legal_entity", "manager__user"
        )
        p = request.query_params
        if p.get("search"):
            term = p["search"]
            qs = qs.filter(
                Q(employee_code__icontains=term)
                | Q(user__first_name__icontains=term)
                | Q(user__last_name__icontains=term)
                | Q(department__name__icontains=term)
            )
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        today = datetime.date.today()
        profiles = {
            pr.employee_id: pr
            for pr in m.EmployeePayrollProfile.objects.filter(
                employee__in=qs, effective_to__isnull=True
            ).select_related("pay_group")
        }
        comps = {}
        for comp in (
            m.EmployeeCompensation.objects.filter(employee__in=qs, status="active")
            .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=today))
            .select_related("structure")
            .order_by("effective_from")
        ):
            if comp.effective_from <= today or comp.employee_id not in comps:
                comps[comp.employee_id] = comp
        pending = set(
            m.CompensationRevision.objects.filter(
                employee__in=qs, status__in=("draft", "pending_approval", "returned")
            ).values_list("employee_id", flat=True)
        )
        if p.get("assignment") == "unassigned":
            qs = qs.exclude(pk__in=list(comps))
        elif p.get("assignment") == "assigned":
            qs = qs.filter(pk__in=list(comps))

        def serialize(items):
            rows = []
            for e in items:
                profile = profiles.get(e.pk)
                rows.append(
                    {
                        **employee_card(e),
                        "payroll_status": profile.payroll_status if profile else None,
                        "pay_group": (
                            profile.pay_group.name if profile and profile.pay_group else None
                        ),
                        "has_profile": profile is not None,
                        "compensation": _comp_brief(comps.get(e.pk)),
                        "has_pending_revision": e.pk in pending,
                    }
                )
            return rows

        return self.paged(qs, serialize)

    def retrieve(self, request, pk=None):
        employee = self.employee_in_scope(pk, "payroll.read")
        profile = svc.profile_for(employee)
        summary = svc.compensation_summary(employee)
        sensitive = user_has_permission(request.user, "payroll.sensitive.read")
        revisions = m.CompensationRevision.objects.filter(employee=employee).select_related(
            "structure"
        )
        return self.ok(
            {
                "employee": employee_card(employee),
                "profile": s.ProfileSerializer(profile).data if profile else None,
                "profile_history": s.ProfileSerializer(
                    m.EmployeePayrollProfile.objects.filter(employee=employee).order_by(
                        "-effective_from"
                    ),
                    many=True,
                ).data,
                "missing": svc.missing_profile_fields(employee, profile),
                **svc.bank_and_statutory(employee, sensitive),
                "compensation": {
                    "current": (
                        s.CompensationSerializer(summary["current"]).data
                        if summary["current"]
                        else None
                    ),
                    "previous": (
                        s.CompensationSerializer(summary["previous"]).data
                        if summary["previous"]
                        else None
                    ),
                    "history": s.CompensationSerializer(summary["history"], many=True).data,
                },
                "revisions": s.RevisionSerializer(revisions, many=True).data,
                "loans": s.LoanSerializer(
                    m.EmployeeDeduction.objects.filter(employee=employee), many=True
                ).data,
                "can_edit": user_has_permission(request.user, "payroll.write"),
                "can_see_sensitive": sensitive,
            }
        )

    @action(detail=True, methods=["put", "patch"])
    def profile(self, request, pk=None):
        employee = self.employee_in_scope(pk, "payroll.write")
        ser = s.ProfileWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        profile = svc.save_profile(employee, dict(ser.validated_data), request.user)
        return self.ok(s.ProfileSerializer(profile).data)

    @action(detail=True, methods=["put", "patch"], url_path="bank-statutory")
    def bank_statutory(self, request, pk=None):
        employee = self.employee_in_scope(pk, "payroll.write")
        svc.save_bank_and_statutory(employee, request.data, request.user)
        employee.refresh_from_db()
        return self.ok(
            svc.bank_and_statutory(
                employee, user_has_permission(request.user, "payroll.sensitive.read")
            )
        )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        employee = self.employee_in_scope(pk, "payroll.read")
        results = (
            m.EmployeePayrollResult.objects.filter(employee=employee, run__status="finalized")
            .select_related("run__period")
            .order_by("-run__period__end_date")[:24]
        )
        return self.ok(
            [
                {
                    "period": f"{r.run.period.year}-{r.run.period.month:02d}",
                    "gross": str(r.gross_earnings),
                    "net": str(r.net_pay),
                    "result_id": str(r.pk),
                }
                for r in results
            ]
        )


class CompensationViewSet(PayrollViewSet):
    """/payroll/compensations/: assignment (PAY-004) and revision (PAY-005)."""

    queryset = m.CompensationRevision.objects.all()
    required_permission = "payroll.read"
    action_permissions = {
        "list": "payroll.read",
        "retrieve": "payroll.read",
        "create": "payroll.write",
        "partial_update": "payroll.write",
        "preview": "payroll.read",
        "submit": "payroll.write",
        "decide": "payroll.read",
        "cancel": "payroll.write",
        "assign": "payroll.write",
        "history": "payroll.read",
    }

    def _revision(self, pk, code):
        revision = self.get_or_404(m.CompensationRevision, pk=pk)
        self.employee_in_scope(revision.employee_id, code)
        return revision

    def list(self, request):
        ids = self.scope_ids("payroll.read")
        qs = m.CompensationRevision.objects.filter(employee_id__in=ids).select_related(
            "employee__user", "employee__department", "structure", "current_compensation__structure"
        )
        p = request.query_params
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("employee_id"):
            qs = qs.filter(employee_id=p["employee_id"])
        if p.get("awaiting_me") == "true":
            stages = [st for st, code in svc.STAGE_PERMISSION.items() if self.can(code)]
            qs = qs.filter(
                status="pending_approval", approvals__status="pending", approvals__stage__in=stages
            ).distinct()
        return self.paged(qs, lambda items: s.RevisionSerializer(items, many=True).data)

    def retrieve(self, request, pk=None):
        return self.ok(s.RevisionSerializer(self._revision(pk, "payroll.read")).data)

    @action(detail=False, methods=["post"])
    def preview(self, request):
        """Generated breakup + current-vs-proposed comparison, nothing saved."""
        employee = self.employee_in_scope(request.data.get("employee"), "payroll.read")
        structure = self.get_or_404(m.SalaryStructure, pk=request.data.get("structure"))
        effective = request.data.get("effective_from") or datetime.date.today().isoformat()
        effective = datetime.date.fromisoformat(effective)
        ctc = request.data.get("annual_ctc") or 0
        proposed = svc.compute_employee_breakup(employee, structure, ctc, effective)
        current = svc.current_compensation(employee, effective)
        current_breakup = None
        if current is not None:
            lines, _ = config_service.lines_for(current.structure, effective)
            current_breakup = config_service.preview_structure(
                lines,
                current.annual_ctc,
                as_of=effective,
                applicability=svc.applicability_for(employee, effective),
            )
        return self.ok(
            {
                "employee": employee_card(employee),
                "proposed": proposed,
                "current": (
                    {
                        "compensation": s.CompensationSerializer(current).data,
                        "breakup": current_breakup,
                    }
                    if current
                    else None
                ),
            }
        )

    def create(self, request):
        ser = s.RevisionWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        employee = data.pop("employee", None)
        if employee is None:
            raise invalid("Choose an employee.", {"employee": ["Required."]})
        self.employee_in_scope(employee.pk, "payroll.write")
        revision = svc.create_revision(employee, data, request.user)
        return self.ok(s.RevisionSerializer(revision).data, status=201)

    @action(detail=False, methods=["post"])
    def assign(self, request):
        """POST /payroll/compensations/assign (contract §6) — same workflow."""
        return self.create(request)

    def partial_update(self, request, pk=None):
        revision = self._revision(pk, "payroll.write")
        ser = s.RevisionWriteSerializer(
            data={
                **{
                    "structure": str(revision.structure_id),
                    "annual_ctc": str(revision.annual_ctc),
                    "effective_from": revision.effective_from.isoformat(),
                },
                **request.data,
            }
        )
        ser.is_valid(raise_exception=True)
        data = {k: v for k, v in ser.validated_data.items() if k in request.data or k == "version"}
        data["version"] = request.data.get("version")
        revision = svc.update_revision(revision, data, request.user)
        if request.data.get("submit"):
            revision = svc.submit_revision(revision, request.user)
        return self.ok(s.RevisionSerializer(revision).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        revision = svc.submit_revision(self._revision(pk, "payroll.write"), request.user)
        return self.ok(s.RevisionSerializer(revision).data)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        revision = self._revision(pk, "payroll.read")
        if not (self.can("payroll.review") or self.can("payroll.approve")):
            raise forbidden("You are not a compensation approver.")
        revision = svc.decide_revision(
            revision,
            request.user,
            request.data.get("decision"),
            request.data.get("comments", ""),
            user_has_permission,
        )
        return self.ok(s.RevisionSerializer(revision).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        revision = svc.cancel_revision(
            self._revision(pk, "payroll.write"), request.user, request.data.get("reason", "")
        )
        return self.ok(s.RevisionSerializer(revision).data)

    @action(detail=False, methods=["get"])
    def history(self, request):
        employee = self.employee_in_scope(request.query_params.get("employee_id"), "payroll.read")
        comps = m.EmployeeCompensation.objects.filter(employee=employee).select_related("structure")
        return self.ok(s.CompensationSerializer(comps, many=True).data)


class MyPayrollViewSet(PayrollViewSet):
    """ESS: an employee's own released payslips, compensation and YTD
    (PAY-FR-027). Always the caller, never an id from the request."""

    queryset = m.Payslip.objects.none()
    required_permission = "payroll.read"
    action_permissions = {
        "payslips": "payroll.read",
        "payslip": "payroll.read",
        "summary": "payroll.read",
    }

    def _me(self):
        employee = getattr(self.request.user, "employee", None)
        if employee is None:
            raise forbidden("Your login is not linked to an employee record.")
        return employee

    @action(detail=False, methods=["get"])
    def payslips(self, request):
        employee = self._me()
        slips = m.Payslip.objects.filter(employee=employee, status="released").select_related(
            "result", "period"
        )
        if request.query_params.get("year"):
            slips = slips.filter(period__year=request.query_params["year"])
        return self.ok(s.PayslipListSerializer(slips, many=True).data)

    @action(detail=False, methods=["get"], url_path=r"payslips/(?P<payslip_id>[^/.]+)")
    def payslip(self, request, payslip_id=None):
        employee = self._me()
        slip = m.Payslip.objects.filter(pk=payslip_id, employee=employee, status="released").first()
        if slip is None:
            raise forbidden("Payslip not found or not yet released.")
        return self.ok(s.PayslipSerializer(slip).data)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        employee = self._me()
        current = svc.current_compensation(employee)
        latest = (
            m.Payslip.objects.filter(employee=employee, status="released")
            .order_by("-period__year", "-period__month")
            .first()
        )
        return self.ok(
            {
                "employee": employee_card(employee),
                "compensation": _comp_brief(current),
                "latest_payslip": s.PayslipListSerializer(latest).data if latest else None,
                "ytd": output_service.ytd_for(employee, latest.period) if latest else None,
            }
        )
