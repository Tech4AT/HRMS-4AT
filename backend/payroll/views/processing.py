"""Monthly processing: periods and inputs (PAY-006..010), calculation and
review (PAY-011..015), approval / finalize / reopen (PAY-016..017)."""

import datetime

from django.db.models import Count, Q
from rest_framework.decorators import action

from core.scope import user_has_permission
from employees.models import Employee
from payroll import models as m
from payroll import serializers as s
from payroll.services import outputs as output_service
from payroll.services import periods as svc
from payroll.services import runs as run_service
from payroll.services.common import employee_card, forbidden, invalid

from .base import RUN_READERS, PayrollViewSet


def _int(value, name):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise invalid(f"{name} is required.", {name: ["Required."]})


class PeriodViewSet(PayrollViewSet):
    queryset = m.PayrollPeriod.objects.all()
    required_permission = "payroll.process"
    P = "payroll.process"
    action_permissions = {
        "list": P,
        "retrieve": P,
        "create": P,
        "partial_update": P,
        "steps": P,
        "readiness": P,
        "attendance": P,
        "attendance_row": P,
        "attendance_import": P,
        "attendance_sync": P,
        "attendance_fill": P,
        "snapshot_inputs": P,
        "inputs": P,
        "input_detail": P,
        "input_decide": P,
        "inputs_import": P,
        "generate_ot": P,
        "generate_loans": P,
        "joiners_exits": P,
        "employee_actions": P,
        "overrides": "payroll.override",
        "override_detail": "payroll.override",
        "calculate": P,
        "complete": "payroll.release",
        "population": P,
    }
    any_permissions = {
        "list": RUN_READERS,
        "retrieve": RUN_READERS,
        "readiness": RUN_READERS,
        "joiners_exits": RUN_READERS,
        "input_decide": ("payroll.process", "payroll.review", "payroll.approve"),
    }

    def get_permissions(self):
        # Reading inputs/attendance is open to all run readers; writing needs payroll.process.
        if self.request.method == "GET" and self.action in (
            "inputs",
            "attendance",
            "overrides",
            "employee_actions",
            "population",
        ):
            self.any_permissions = {**self.any_permissions, self.action: RUN_READERS}
        return super().get_permissions()

    def _period(self, pk):
        return self.get_or_404(m.PayrollPeriod, pk=pk)

    def list(self, request):
        qs = m.PayrollPeriod.objects.select_related("pay_group")
        if request.query_params.get("pay_group"):
            qs = qs.filter(pay_group_id=request.query_params["pay_group"])
        if request.query_params.get("year"):
            qs = qs.filter(year=request.query_params["year"])
        return self.ok(s.PeriodSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        period = self._period(pk)
        data = s.PeriodSerializer(period).data
        data["steps"] = [
            {"key": k, "label": label, "status": (period.step_status or {}).get(k)}
            for k, label in svc.STEPS
        ]
        return self.ok(data)

    def create(self, request):
        group = self.get_or_404(m.PayGroup, pk=request.data.get("pay_group"))
        pay_date = request.data.get("pay_date")
        period = svc.create_period(
            group,
            _int(request.data.get("year"), "year"),
            _int(request.data.get("month"), "month"),
            request.user,
            datetime.date.fromisoformat(pay_date) if pay_date else None,
            request.data.get("working_days"),
        )
        return self.ok(s.PeriodSerializer(period).data, status=201)

    def partial_update(self, request, pk=None):
        from payroll.services.common import audit, check_version, ensure_unlocked

        period = self._period(pk)
        ensure_unlocked(period)
        check_version(period, request.data.get("version"))
        for field in ("pay_date", "working_days", "notes"):
            if field in request.data:
                value = request.data[field]
                setattr(
                    period,
                    field,
                    datetime.date.fromisoformat(value) if field == "pay_date" else value,
                )
        period.version += 1
        period.updated_by = request.user
        period.save()
        audit(
            request.user,
            "period.updated",
            period,
            changes={k: request.data[k] for k in request.data if k != "version"},
        )
        return self.ok(s.PeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def steps(self, request, pk=None):
        period = svc.set_step_status(
            self._period(pk),
            request.data.get("step"),
            request.data.get("status", "completed"),
            request.user,
        )
        return self.ok(s.PeriodSerializer(period).data)

    @action(detail=True, methods=["get"])
    def readiness(self, request, pk=None):
        return self.ok(svc.readiness(self._period(pk)))

    @action(detail=True, methods=["get"])
    def population(self, request, pk=None):
        return self.ok([employee_card(e) for e in svc.population(self._period(pk))])

    # -- attendance (PAY-007) --------------------------------------------------

    @action(detail=True, methods=["get"])
    def attendance(self, request, pk=None):
        period = self._period(pk)
        rows = {a.employee_id: a for a in period.attendance.select_related("employee__user")}
        data = []
        for employee in svc.population(period):
            row = rows.get(employee.pk)
            data.append(
                {
                    "employee": employee_card(employee),
                    "attendance": None if row is None else s.AttendanceSerializer(row).data,
                    "status": (
                        "missing"
                        if row is None
                        else (
                            "pending"
                            if row.status != "final"
                            else ("lop" if row.lop_days > 0 else "ready")
                        )
                    ),
                }
            )
        snap = period.snapshots.filter(kind="attendance").order_by("-version").first()
        summary = {
            "total": len(data),
            "ready": sum(1 for d in data if d["status"] in ("ready", "lop")),
            "missing": sum(1 for d in data if d["status"] == "missing"),
            "pending": sum(1 for d in data if d["status"] == "pending"),
            "with_lop": sum(1 for d in data if d["status"] == "lop"),
            "ot_hours": str(sum((r.ot_hours for r in rows.values()), 0)),
            "ot_employees": sum(1 for r in rows.values() if r.ot_hours),
            "pending_leave": sum(1 for r in rows.values() if r.pending_leave_requests),
            "snapshot": (
                None
                if snap is None
                else {
                    "version": snap.version,
                    "checksum": snap.checksum,
                    "captured_at": snap.captured_at.isoformat(),
                    "is_final": snap.is_final,
                }
            ),
            "source_connected": svc._attendance_provider() is not None,
        }
        return self.ok(data, meta={"summary": summary})

    @action(detail=True, methods=["put"], url_path=r"attendance/(?P<employee_id>[0-9]+)")
    def attendance_row(self, request, pk=None, employee_id=None):
        period = self._period(pk)
        if not svc.population(period).filter(pk=employee_id).exists():
            raise invalid("This employee is not in this payroll.")
        row = svc.save_attendance(period, employee_id, request.data, request.user)
        return self.ok(s.AttendanceSerializer(row).data)

    @action(detail=True, methods=["post"], url_path="attendance/import")
    def attendance_import(self, request, pk=None):
        return self.ok(
            svc.import_attendance_csv(self._period(pk), request.data.get("csv", ""), request.user)
        )

    @action(detail=True, methods=["post"], url_path="attendance/sync")
    def attendance_sync(self, request, pk=None):
        return self.ok({"synced": svc.sync_attendance(self._period(pk), request.user)})

    @action(detail=True, methods=["post"], url_path="attendance/fill-missing")
    def attendance_fill(self, request, pk=None):
        return self.ok({"created": svc.fill_missing_attendance(self._period(pk), request.user)})

    @action(detail=True, methods=["post"], url_path="snapshot-inputs")
    def snapshot_inputs(self, request, pk=None):
        snap = svc.capture_snapshot(
            self._period(pk), request.data.get("kind", "attendance"), request.user
        )
        return self.ok(
            {
                "id": str(snap.pk),
                "kind": snap.kind,
                "version": snap.version,
                "checksum": snap.checksum,
                "is_final": snap.is_final,
                "row_count": snap.row_count,
            }
        )

    # -- inputs (PAY-008/010) --------------------------------------------------

    @action(detail=True, methods=["get", "post"])
    def inputs(self, request, pk=None):
        period = self._period(pk)
        if request.method == "POST":
            ser = s.InputWriteSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            record = svc.add_input(period, dict(ser.validated_data), request.user)
            data = s.InputSerializer(record).data
            data["possible_duplicates"] = svc.duplicates_of(record).count()
            return self.ok(data, status=201)
        qs = period.inputs.select_related(
            "employee__user", "employee__department", "component", "approved_by", "created_by"
        )
        p = request.query_params
        if p.get("type"):
            qs = qs.filter(input_type__in=p["type"].split(","))
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("employee_id"):
            qs = qs.filter(employee_id=p["employee_id"])
        if p.get("search"):
            qs = qs.filter(
                Q(employee__employee_code__icontains=p["search"])
                | Q(employee__user__first_name__icontains=p["search"])
                | Q(reason__icontains=p["search"])
            )
        counts = dict(period.inputs.values_list("input_type").annotate(n=Count("id")))
        pending = period.inputs.filter(status="pending").count()
        response = self.paged(qs, lambda items: s.InputSerializer(items, many=True).data)
        response.data["meta"].update({"counts": counts, "pending": pending})
        return response

    @action(
        detail=True, methods=["patch", "delete"], url_path=r"inputs/(?P<input_id>[0-9a-f-]{36})"
    )
    def input_detail(self, request, pk=None, input_id=None):
        record = self.get_or_404(m.PayrollInput, pk=input_id, period_id=pk)
        if request.method == "DELETE":
            svc.delete_input(record, request.user)
            return self.ok({"deleted": True})
        ser = s.InputWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        record = svc.update_input(record, dict(ser.validated_data), request.user)
        return self.ok(s.InputSerializer(record).data)

    @action(detail=True, methods=["post"], url_path=r"inputs/(?P<input_id>[0-9a-f-]{36})/decide")
    def input_decide(self, request, pk=None, input_id=None):
        record = self.get_or_404(m.PayrollInput, pk=input_id, period_id=pk)
        if record.created_by_id == request.user.pk and not run_service._allow_self_approval():
            raise forbidden("Maker-checker: someone else must approve an input you entered.")
        record = svc.decide_input(
            record, request.data.get("decision"), request.user, request.data.get("comment", "")
        )
        return self.ok(s.InputSerializer(record).data)

    @action(detail=True, methods=["post"], url_path="inputs/import")
    def inputs_import(self, request, pk=None):
        return self.ok(
            svc.import_inputs_csv(
                self._period(pk),
                request.data.get("csv", ""),
                request.user,
                request.data.get("batch_id", ""),
            )
        )

    @action(detail=True, methods=["post"], url_path="inputs/generate-ot")
    def generate_ot(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=request.data.get("component"))
        return self.ok(
            {"created": svc.generate_ot_inputs(self._period(pk), component, request.user)}
        )

    @action(detail=True, methods=["post"], url_path="inputs/generate-loans")
    def generate_loans(self, request, pk=None):
        return self.ok({"created": svc.generate_loan_recoveries(self._period(pk), request.user)})

    # -- joiners, exits, holds (PAY-009) -----------------------------------------

    @action(detail=True, methods=["get"], url_path="joiners-exits")
    def joiners_exits(self, request, pk=None):
        period = self._period(pk)
        joiners, exits = svc.joiners_and_exits(period)
        run = run_service.current_run(period)
        results = {r.employee_id: r for r in run.results.all()} if run else {}

        def row(employee, date, action_obj):
            r = results.get(employee.pk)
            comp = (
                m.EmployeeCompensation.objects.filter(employee=employee, status="active")
                .order_by("-effective_from")
                .first()
            )
            return {
                "employee": employee_card(employee),
                "date": date.isoformat(),
                "decision": action_obj.decision if action_obj else None,
                "reason": action_obj.reason if action_obj else "",
                "monthly_gross": (
                    (comp.breakup.get("totals") or {}).get("gross_monthly") if comp else None
                ),
                "payable_days": str(r.payable_days) if r else None,
                "working_days": str(r.working_days) if r else None,
                "net_pay": str(r.net_pay) if r else None,
            }

        return self.ok(
            {
                "joiners": [row(*j) for j in joiners],
                "exits": [row(*x) for x in exits],
                "prorated": sum(1 for r in results.values() if r.is_joiner or r.is_exit),
            }
        )

    @action(detail=True, methods=["get", "post"], url_path="employee-actions")
    def employee_actions(self, request, pk=None):
        period = self._period(pk)
        if request.method == "POST":
            employee = self.get_or_404(Employee, pk=request.data.get("employee"))
            record = svc.set_employee_action(
                period,
                employee,
                request.data.get("kind"),
                request.data.get("decision"),
                request.data.get("reason", ""),
                request.user,
            )
            return self.ok({"id": str(record.pk), "kind": record.kind, "decision": record.decision})
        actions = period.employee_actions.select_related("employee__user")
        if request.query_params.get("kind"):
            actions = actions.filter(kind=request.query_params["kind"])
        return self.ok(
            [
                {
                    "id": str(a.pk),
                    "employee": employee_card(a.employee),
                    "kind": a.kind,
                    "decision": a.decision,
                    "reason": a.reason,
                    "updated_at": a.updated_at.isoformat(),
                }
                for a in actions
            ]
        )

    # -- overrides -----------------------------------------------------------------

    @action(detail=True, methods=["get", "post"])
    def overrides(self, request, pk=None):
        period = self._period(pk)
        if request.method == "POST":
            employee = self.get_or_404(Employee, pk=request.data.get("employee"))
            component = self.get_or_404(m.SalaryComponent, pk=request.data.get("component"))
            amount = request.data.get("amount")
            if amount in (None, ""):
                raise invalid("Enter the override amount.", {"amount": ["Required."]})
            override = svc.add_override(
                period, employee, component, amount, request.data.get("reason", ""), request.user
            )
            return self.ok(s.OverrideSerializer(override).data, status=201)
        return self.ok(
            s.OverrideSerializer(
                period.overrides.filter(is_active=True).select_related(
                    "employee__user", "component"
                ),
                many=True,
            ).data
        )

    @action(detail=True, methods=["delete"], url_path=r"overrides/(?P<override_id>[0-9a-f-]{36})")
    def override_detail(self, request, pk=None, override_id=None):
        override = self.get_or_404(m.PayrollOverride, pk=override_id, period_id=pk)
        svc.remove_override(override, request.user, request.query_params.get("reason", ""))
        return self.ok({"removed": True})

    # -- calculation (PAY-011) -----------------------------------------------------

    @action(detail=True, methods=["post"])
    def calculate(self, request, pk=None):
        period = self._period(pk)

        def run():
            result = run_service.calculate(
                period,
                request.user,
                request.data.get("employee_ids"),
                request.data.get("mode", "DRAFT_RECALCULATION"),
            )
            return self.ok(s.RunSerializer(result).data, status=201)

        return self.idempotent(f"calculate:{period.pk}", run)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        period = self._period(pk)
        run = period.runs.filter(status="finalized").order_by("-run_no").first()
        if run is None:
            raise invalid("Finalize the payroll first.")
        period = output_service.complete_period(
            period, run, request.user, request.data.get("notes", "")
        )
        return self.ok(s.PeriodSerializer(period).data)


class RunViewSet(PayrollViewSet):
    queryset = m.PayrollRun.objects.all()
    required_permission = "payroll.process"
    action_permissions = {
        "retrieve": "payroll.process",
        "results": "payroll.process",
        "exceptions": "payroll.process",
        "submit": "payroll.process",
        "approvals": "payroll.review",
        "finalize": "payroll.finalize",
        "reopen": "payroll.reopen",
        "payslips": "payroll.release",
        "payslips_generate": "payroll.release",
        "payslips_release": "payroll.release",
        "outputs": "payroll.release",
        "checklist": "payroll.process",
        "list": "payroll.process",
    }
    any_permissions = {
        "retrieve": RUN_READERS,
        "results": RUN_READERS,
        "exceptions": RUN_READERS,
        "checklist": RUN_READERS,
        "list": RUN_READERS,
        "approvals": ("payroll.review", "payroll.approve"),
    }

    def get_permissions(self):
        if self.request.method == "GET" and self.action in ("payslips", "outputs"):
            self.any_permissions = {**self.any_permissions, self.action: RUN_READERS}
        return super().get_permissions()

    def _run(self, pk):
        return self.get_or_404(m.PayrollRun, pk=pk)

    def list(self, request):
        qs = m.PayrollRun.objects.all()
        if request.query_params.get("period"):
            qs = qs.filter(period_id=request.query_params["period"])
        return self.ok(s.RunSerializer(qs.order_by("-run_no"), many=True).data)

    def retrieve(self, request, pk=None):
        run = self._run(pk)
        data = s.RunSerializer(run).data
        data["period"] = s.PeriodSerializer(run.period).data
        data["tab_counts"] = self._tab_counts(run)
        return self.ok(data)

    def _tab_counts(self, run):
        results = run.results.filter(employee_id__in=self.scope_ids("payroll.read"))
        period = run.period
        return {
            "all": results.count(),
            "exceptions": results.filter(validation_status__in=("error", "warning")).count(),
            "joiners": results.filter(is_joiner=True).count(),
            "exits": results.filter(is_exit=True).count(),
            "revisions": results.filter(has_revision=True).count(),
            "reimbursements": period.inputs.filter(input_type="reimbursement")
            .exclude(status__in=("rejected", "superseded"))
            .count(),
            "holds": results.filter(is_on_hold=True).count(),
        }

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        run = self._run(pk)
        qs = run.results.filter(employee_id__in=self.scope_ids("payroll.read")).annotate(
            exception_count=Count("exceptions", filter=Q(exceptions__status="open"))
        )
        p = request.query_params
        tab = p.get("tab")
        if tab == "exceptions":
            qs = qs.filter(validation_status__in=("error", "warning"))
        elif tab == "joiners":
            qs = qs.filter(is_joiner=True)
        elif tab == "exits":
            qs = qs.filter(is_exit=True)
        elif tab == "revisions":
            qs = qs.filter(has_revision=True)
        elif tab == "holds":
            qs = qs.filter(is_on_hold=True)
        elif tab == "reimbursements":
            ids = run.period.inputs.filter(input_type="reimbursement").values_list(
                "employee_id", flat=True
            )
            qs = qs.filter(employee_id__in=ids)
        if p.get("status"):
            qs = qs.filter(validation_status=p["status"])
        if p.get("department"):
            qs = qs.filter(employee__department__name=p["department"])
        if p.get("search"):
            term = p["search"]
            qs = qs.filter(
                Q(employee__employee_code__icontains=term)
                | Q(employee__user__first_name__icontains=term)
                | Q(employee__user__last_name__icontains=term)
                | Q(employee__department__name__icontains=term)
            )
        departments = sorted(
            {r.employee_snapshot.get("department") or "" for r in run.results.all()} - {""}
        )
        response = self.paged(
            qs.order_by("employee__employee_code"),
            lambda items: s.ResultSerializer(items, many=True).data,
        )
        response.data["meta"]["departments"] = departments
        return response

    @action(detail=True, methods=["get"])
    def exceptions(self, request, pk=None):
        run = self._run(pk)
        qs = run.exceptions.select_related("result").filter(
            Q(employee_id__isnull=True) | Q(employee_id__in=self.scope_ids("payroll.read"))
        )
        if request.query_params.get("severity"):
            qs = qs.filter(severity=request.query_params["severity"])
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return self.ok(s.ExceptionSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        return self.ok(s.RunSerializer(run_service.submit(self._run(pk), request.user)).data)

    @action(detail=True, methods=["post"])
    def approvals(self, request, pk=None):
        run = run_service.decide(
            self._run(pk),
            request.user,
            request.data.get("decision"),
            request.data.get("comments", ""),
            user_has_permission,
        )
        return self.ok(s.RunSerializer(run).data)

    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        run = self._run(pk)
        return self.idempotent(
            f"finalize:{run.pk}",
            lambda: self.ok(s.RunSerializer(run_service.finalize(run, request.user)).data),
        )

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        return self.ok(
            s.RunSerializer(
                run_service.reopen(self._run(pk), request.user, request.data.get("reason", ""))
            ).data
        )

    @action(detail=True, methods=["get"])
    def payslips(self, request, pk=None):
        run = self._run(pk)
        slips = (
            m.Payslip.objects.filter(result__run=run)
            .select_related("result")
            .filter(employee_id__in=self.scope_ids("payroll.read"))
        )
        return self.ok(s.PayslipListSerializer(slips, many=True).data)

    @action(detail=True, methods=["post"], url_path="payslips/generate")
    def payslips_generate(self, request, pk=None):
        run = self._run(pk)
        return self.idempotent(
            f"payslips:{run.pk}",
            lambda: self.ok({"generated": output_service.generate_payslips(run, request.user)}),
        )

    @action(detail=True, methods=["post"], url_path="payslips/release")
    def payslips_release(self, request, pk=None):
        return self.ok({"released": output_service.release_payslips(self._run(pk), request.user)})

    @action(detail=True, methods=["get", "post"])
    def outputs(self, request, pk=None):
        run = self._run(pk)
        if request.method == "POST":
            kind = request.data.get("kind")
            output = output_service.generate_output(run, kind, request.user)
            return self.ok(s.OutputSerializer(output).data, status=201)
        return self.ok(s.OutputSerializer(run.outputs.all(), many=True).data)

    @action(detail=True, methods=["get"])
    def checklist(self, request, pk=None):
        return self.ok(output_service.checklist(self._run(pk)))


class ResultViewSet(PayrollViewSet):
    queryset = m.EmployeePayrollResult.objects.all()
    required_permission = "payroll.read"
    action_permissions = {"retrieve": "payroll.read", "trace": "payroll.read"}

    def _result(self, pk):
        result = self.get_or_404(m.EmployeePayrollResult, pk=pk)
        if not (
            self.can("payroll.process")
            or self.can("payroll.review")
            or self.can("payroll.approve")
            or self.can("payroll.audit")
        ):
            raise forbidden("Payroll results are visible to payroll, finance and audit roles.")
        self.employee_in_scope(result.employee_id, "payroll.read")
        return result

    def retrieve(self, request, pk=None):
        result = self._result(pk)
        data = s.ResultDetailSerializer(result).data
        att = m.AttendancePayrollInput.objects.filter(
            period=result.run.period, employee=result.employee
        ).first()
        data["attendance"] = s.AttendanceSerializer(att).data if att else None
        data["segments"] = result.segments
        return self.ok(data)

    @action(detail=True, methods=["get"])
    def trace(self, request, pk=None):
        """GET /payroll/results/{id}/trace (PAY-012)."""
        result = self._result(pk)
        run = result.run
        return self.ok(
            {
                "employee": result.employee_snapshot,
                "period": str(run.period),
                "run": {
                    "run_no": run.run_no,
                    "status": run.status,
                    "engine_version": run.engine_version,
                    "input_snapshot_id": run.input_snapshot_id,
                    "configuration_snapshot_id": run.configuration_snapshot_id,
                    "generated_at": run.calculated_at.isoformat() if run.calculated_at else None,
                },
                "days": {
                    "working_days": str(result.working_days),
                    "payable_days": str(result.payable_days),
                    "lop_days": str(result.lop_days),
                },
                "segments": result.segments,
                "lines": s.ResultLineSerializer(result.lines.all(), many=True).data,
                "totals": {
                    "gross": str(result.gross_earnings),
                    "deductions": str(result.total_deductions),
                    "net_pay": str(result.net_pay),
                    "employer_cost": str(result.employer_cost),
                },
            }
        )


class ExceptionViewSet(PayrollViewSet):
    queryset = m.PayrollException.objects.all()
    required_permission = "payroll.process"
    action_permissions = {"acknowledge": "payroll.process"}

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        exception = self.get_or_404(m.PayrollException, pk=pk)
        exception = run_service.acknowledge_exception(
            exception, request.user, request.data.get("note", "")
        )
        return self.ok(s.ExceptionSerializer(exception).data)
