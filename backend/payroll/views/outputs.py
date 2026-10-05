"""Payslips (admin), output files, reports, audit trail, dashboard, loans and
reference data for the payroll screens."""

import csv
import io

from rest_framework.decorators import action

from audit.service import write_audit
from core.scope import user_effective_permissions
from employees.models import Employee, LegalEntity
from payroll import models as m
from payroll import serializers as s
from payroll.integrations import approvals_bridge
from payroll.services import outputs as output_service
from payroll.services import reports as report_service
from payroll.services.common import audit, forbidden, invalid, not_found

from .base import CONFIG_READERS, RUN_READERS, PayrollViewSet


class PayslipViewSet(PayrollViewSet):
    """A payslip as payroll/HR sees it (scope-checked). Employees use /my/."""

    queryset = m.Payslip.objects.all()
    required_permission = "payroll.read"
    action_permissions = {"retrieve": "payroll.read", "list": "payroll.read"}
    any_permissions = {"list": RUN_READERS}

    def list(self, request):
        ids = self.scope_ids("payroll.read")
        qs = m.Payslip.objects.filter(employee_id__in=ids).select_related("result", "period")
        if request.query_params.get("employee_id"):
            qs = qs.filter(employee_id=request.query_params["employee_id"])
        if request.query_params.get("period"):
            qs = qs.filter(period_id=request.query_params["period"])
        return self.ok(s.PayslipListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        slip = self.get_or_404(m.Payslip, pk=pk)
        self.employee_in_scope(slip.employee_id, "payroll.read")
        own = (
            getattr(request.user, "employee", None) is not None
            and request.user.employee.pk == slip.employee_id
        )
        if own and slip.status != "released" and not self.can("payroll.release"):
            raise forbidden("This payslip has not been released yet.")
        if not own and not any(self.can(c) for c in RUN_READERS):
            raise forbidden("Only payroll roles can open other employees' payslips.")
        data = s.PayslipSerializer(slip).data
        data["other_months"] = s.PayslipListSerializer(
            m.Payslip.objects.filter(employee_id=slip.employee_id)
            .exclude(status="superseded")
            .order_by("-period__year", "-period__month")[:12],
            many=True,
        ).data
        data["ytd"] = slip.payload.get("ytd") or output_service.ytd_for(slip.employee, slip.period)
        return self.ok(data)


class OutputViewSet(PayrollViewSet):
    queryset = m.PayrollOutput.objects.all()
    required_permission = "payroll.release"
    action_permissions = {"download": "payroll.release", "mark_paid": "payroll.release"}
    any_permissions = {"download": ("payroll.release", "payroll.audit")}

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        output = self.get_or_404(m.PayrollOutput, pk=pk)
        audit(request.user, "output.downloaded", output, kind=output.kind, version=output.version)
        return self.ok(
            {
                "file_name": output.file_name,
                "content": output.content,
                "kind": output.kind,
                "version": output.version,
                "status": output.status,
            }
        )

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        output = output_service.mark_paid(self.get_or_404(m.PayrollOutput, pk=pk), request.user)
        return self.ok(s.OutputSerializer(output).data)


class ReportViewSet(PayrollViewSet):
    queryset = m.PayrollRun.objects.none()
    required_permission = "payroll.audit"
    action_permissions = {"list": "payroll.audit", "retrieve": "payroll.audit"}
    any_permissions = {"list": RUN_READERS, "retrieve": RUN_READERS}

    def list(self, request):
        return self.ok([{"key": k, "title": v} for k, v in report_service.REPORTS.items()])

    def retrieve(self, request, pk=None):
        if pk not in report_service.REPORTS:
            raise not_found("Unknown report.")
        if pk == "audit_trail" and not self.can("payroll.audit"):
            raise forbidden("The audit trail needs the payroll audit permission.")
        period = None
        if request.query_params.get("period"):
            period = self.get_or_404(m.PayrollPeriod, pk=request.query_params["period"])
        elif pk != "audit_trail":
            raise invalid("Choose a payroll period.", {"period": ["Required."]})
        report = report_service.build_report(
            pk, period, self.scope_ids("payroll.read"), request.query_params
        )
        if request.query_params.get("format") == "csv":
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow([c["label"] for c in report["columns"]])
            for row in report["rows"]:
                writer.writerow([row.get(c["key"], "") for c in report["columns"]])
            write_audit(
                request.user,
                "payroll.report.exported",
                "PayrollReport",
                pk,
                {"period": report.get("period"), "rows": len(report["rows"])},
            )
            return self.ok(
                {
                    "file_name": f"{pk}_{report.get('period', '').replace(' ', '_')}.csv",
                    "content": buffer.getvalue(),
                }
            )
        return self.ok(report)


class AuditViewSet(PayrollViewSet):
    queryset = m.PayrollRun.objects.none()
    required_permission = "payroll.audit"
    action_permissions = {"list": "payroll.audit"}

    def list(self, request):
        return self.ok(report_service.payroll_audit(request.query_params))


class DashboardViewSet(PayrollViewSet):
    queryset = m.PayrollRun.objects.none()
    required_permission = "payroll.process"
    action_permissions = {"list": "payroll.process"}
    any_permissions = {"list": RUN_READERS}

    def list(self, request):
        groups = m.PayGroup.objects.filter(is_active=True)
        group_id = request.query_params.get("pay_group")
        group = groups.filter(pk=group_id).first() if group_id else groups.first()
        if group is None:
            return self.ok({"pay_group": None, "pay_groups": [], "period": None})
        period = None
        if request.query_params.get("period"):
            period = self.get_or_404(
                m.PayrollPeriod, pk=request.query_params["period"], pay_group=group
            )
        data = report_service.dashboard(group, period, self.scope_ids("payroll.read"))
        data["pay_groups"] = [{"id": str(g.pk), "name": g.name, "code": g.code} for g in groups]
        return self.ok(data)


class LoanViewSet(PayrollViewSet):
    """Loans and advances whose instalments become recovery inputs."""

    queryset = m.EmployeeDeduction.objects.all()
    required_permission = "payroll.write"
    action_permissions = {
        "list": "payroll.write",
        "create": "payroll.write",
        "partial_update": "payroll.write",
    }
    any_permissions = {"list": RUN_READERS + ("payroll.write",)}

    def list(self, request):
        qs = m.EmployeeDeduction.objects.filter(
            employee_id__in=self.scope_ids("payroll.read")
        ).select_related("employee__user", "component")
        if request.query_params.get("employee_id"):
            qs = qs.filter(employee_id=request.query_params["employee_id"])
        return self.ok(s.LoanSerializer(qs, many=True).data)

    def create(self, request):
        self.employee_in_scope(request.data.get("employee"), "payroll.write")
        ser = s.LoanSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if (
            ser.validated_data.get("component") is None
            or ser.validated_data["component"].component_type != "deduction"
        ):
            raise invalid(
                "Choose the deduction component instalments are posted to.",
                {"component": ["Required."]},
            )
        loan = ser.save()
        audit(request.user, "loan.created", loan)
        return self.ok(s.LoanSerializer(loan).data, status=201)

    def partial_update(self, request, pk=None):
        loan = self.get_or_404(m.EmployeeDeduction, pk=pk)
        self.employee_in_scope(loan.employee_id, "payroll.write")
        ser = s.LoanSerializer(loan, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        loan = ser.save()
        audit(request.user, "loan.updated", loan)
        return self.ok(s.LoanSerializer(loan).data)


class MetaViewSet(PayrollViewSet):
    """Choice lists and the caller's payroll capabilities for UI gating."""

    queryset = m.PayGroup.objects.none()
    required_permission = "payroll.read"
    action_permissions = {"list": "payroll.read"}

    def list(self, request):
        perms = user_effective_permissions(request.user) if hasattr(request.user, "pk") else set()
        codes = {getattr(p, "code", p) for p in perms} if perms else set()
        if request.user.is_superuser:
            from core.registry import registered_permissions

            codes = set(registered_permissions())

        def choices(options):
            return [{"value": v, "label": str(label)} for v, label in options]

        return self.ok(
            {
                "component_types": choices(m.SalaryComponent.TYPE_CHOICES),
                "categories": choices(m.SalaryComponent.CATEGORY_CHOICES),
                "calculation_types": choices(m.SalaryComponent.CALCULATION_CHOICES),
                "rounding": choices(m.ROUNDING_CHOICES),
                "statutory_codes": choices(m.StatutoryRule.CODE_CHOICES),
                "input_types": choices(m.PayrollInput.TYPE_CHOICES),
                "revision_types": choices(m.CompensationRevision.TYPE_CHOICES),
                "payroll_statuses": choices(m.EmployeePayrollProfile.STATUS_CHOICES),
                "payment_modes": choices(m.EmployeePayrollProfile.PAYMENT_MODE_CHOICES),
                "proration_bases": choices(m.PayGroup.PRORATION_CHOICES),
                "output_kinds": choices(m.PayrollOutput.KIND_CHOICES),
                "legal_entities": [
                    {"value": e.pk, "label": e.name} for e in LegalEntity.objects.all()
                ],
                "permissions": sorted(c for c in codes if str(c).startswith("payroll.")),
                "employee_id": getattr(getattr(request.user, "employee", None), "pk", None),
                "config_reader": any(c in codes for c in CONFIG_READERS),
                "employee_count": Employee.objects.count(),
                "approver_candidates": (
                    approvals_bridge.approver_candidates()
                    if any(c in codes for c in ("payroll.manage",))
                    else {}
                ),
            }
        )
