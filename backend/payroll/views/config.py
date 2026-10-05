"""PAY-001 components, PAY-002 structures, statutory rules and pay groups."""

import datetime

from django.db.models import Q
from rest_framework.decorators import action

from audit.models import AuditLog
from payroll import models as m
from payroll import serializers as s
from payroll.engine import formula as formula_engine
from payroll.services import config as svc
from payroll.services.common import audit, check_version, diff, invalid, snapshot

from .base import CONFIG_READERS, PayrollViewSet


def _history(entity_type, entity_id):
    logs = AuditLog.objects.filter(
        entity_type=entity_type, entity_id=str(entity_id)
    ).select_related("actor")
    return [
        {
            "id": log.pk,
            "action": log.action.removeprefix("payroll."),
            "at": log.created_at.isoformat(),
            "actor": (log.actor.get_full_name() or log.actor.email) if log.actor else "system",
            "diff": log.diff,
        }
        for log in logs.order_by("-id")[:100]
    ]


class ComponentViewSet(PayrollViewSet):
    """/api/v1/payroll/components/ (API contract §6)."""

    queryset = m.SalaryComponent.objects.all()
    required_permission = "payroll.manage"
    action_permissions = {
        "list": "payroll.manage",
        "retrieve": "payroll.manage",
        "create": "payroll.manage",
        "partial_update": "payroll.manage",
        "destroy": "payroll.manage",
        "activate": "payroll.manage",
        "deactivate": "payroll.manage",
        "history": "payroll.manage",
        "validate_formula": "payroll.manage",
    }
    any_permissions = {
        "list": CONFIG_READERS,
        "retrieve": CONFIG_READERS,
        "history": CONFIG_READERS,
    }

    def list(self, request):
        qs = m.SalaryComponent.objects.all()
        p = request.query_params
        if p.get("type"):
            qs = qs.filter(component_type=p["type"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        if p.get("calculation_type"):
            qs = qs.filter(calculation_type=p["calculation_type"])
        if p.get("search"):
            qs = qs.filter(Q(code__icontains=p["search"]) | Q(name__icontains=p["search"]))
        all_qs = m.SalaryComponent.objects.all()
        summary = {
            kind: all_qs.filter(component_type=kind).count()
            for kind in ("earning", "deduction", "employer_contribution")
        }
        summary["active"] = all_qs.filter(status="active").count()
        summary["total"] = all_qs.count()
        response = self.paged(qs, lambda items: s.SalaryComponentSerializer(items, many=True).data)
        response.data["meta"]["summary"] = summary
        return response

    def retrieve(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        return self.ok(s.SalaryComponentSerializer(component).data)

    def create(self, request):
        ser = s.ComponentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        component = svc.create_component(ser.validated_data, request.user)
        return self.ok(s.SalaryComponentSerializer(component).data, status=201)

    def partial_update(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        ser = s.ComponentWriteSerializer(component, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        data["version"] = request.data.get("version")
        if request.data.get("change_effective_from"):
            data["change_effective_from"] = request.data["change_effective_from"]
        component = svc.update_component(
            component, data, request.user, request.data.get("reason", "")
        )
        return self.ok(s.SalaryComponentSerializer(component).data)

    def destroy(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        svc.delete_component(component, request.user)
        return self.ok({"deleted": True})

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        component = svc.set_component_status(
            component, "active", request.user, request.data.get("reason", "")
        )
        return self.ok(s.SalaryComponentSerializer(component).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        date = request.data.get("effective_date")
        component = svc.set_component_status(
            component,
            "inactive",
            request.user,
            request.data.get("reason", ""),
            datetime.date.fromisoformat(date) if date else None,
        )
        return self.ok(s.SalaryComponentSerializer(component).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        component = self.get_or_404(m.SalaryComponent, pk=pk)
        return self.ok(
            {
                "versions": s.ComponentVersionSerializer(component.versions.all(), many=True).data,
                "audit": _history("SalaryComponent", component.pk),
            }
        )

    @action(detail=False, methods=["post"], url_path="validate-formula")
    def validate_formula(self, request):
        expr = request.data.get("formula_expr", "")
        code = (request.data.get("code") or "").upper()
        known = set(m.SalaryComponent.objects.values_list("code", flat=True)) | (
            {code} if code else set()
        )
        try:
            refs = formula_engine.validate(expr, known)
            if code and code in refs:
                raise formula_engine.FormulaError("A formula cannot refer to its own component.")
            svc._check_component_cycles(code or "__NEW__", refs)
        except Exception as exc:  # noqa: BLE001 - reported to the builder
            return self.ok({"valid": False, "error": str(exc)})
        return self.ok({"valid": True, "references": sorted(refs)})


class StructureViewSet(PayrollViewSet):
    queryset = m.SalaryStructure.objects.all()
    required_permission = "payroll.manage"
    action_permissions = {
        "list": "payroll.manage",
        "retrieve": "payroll.manage",
        "create": "payroll.manage",
        "partial_update": "payroll.manage",
        "activate": "payroll.manage",
        "deactivate": "payroll.manage",
        "clone": "payroll.manage",
        "versions": "payroll.manage",
        "preview": "payroll.manage",
        "preview_draft": "payroll.manage",
    }
    any_permissions = {
        "list": CONFIG_READERS,
        "retrieve": CONFIG_READERS,
        "versions": CONFIG_READERS,
        "preview": CONFIG_READERS,
        "preview_draft": CONFIG_READERS,
    }

    def list(self, request):
        qs = m.SalaryStructure.objects.select_related("legal_entity", "pay_group").prefetch_related(
            "lines__component"
        )
        p = request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("search"):
            qs = qs.filter(Q(code__icontains=p["search"]) | Q(name__icontains=p["search"]))
        if p.get("ctc"):
            ctc = p["ctc"]
            qs = qs.filter(Q(min_ctc__isnull=True) | Q(min_ctc__lte=ctc)).filter(
                Q(max_ctc__isnull=True) | Q(max_ctc__gte=ctc)
            )
        return self.paged(qs, lambda items: s.SalaryStructureSerializer(items, many=True).data)

    def retrieve(self, request, pk=None):
        structure = self.get_or_404(m.SalaryStructure, pk=pk)
        return self.ok(s.SalaryStructureSerializer(structure).data)

    def create(self, request):
        ser = s.StructureWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        structure = svc.create_structure(dict(ser.validated_data), request.user)
        return self.ok(s.SalaryStructureSerializer(structure).data, status=201)

    def partial_update(self, request, pk=None):
        structure = self.get_or_404(m.SalaryStructure, pk=pk)
        ser = s.StructureWriteSerializer(structure, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        data["version"] = request.data.get("version")
        if request.data.get("change_effective_from"):
            data["change_effective_from"] = request.data["change_effective_from"]
        structure = svc.update_structure(
            structure, data, request.user, request.data.get("reason", "")
        )
        return self.ok(s.SalaryStructureSerializer(structure).data)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        structure = svc.activate_structure(
            self.get_or_404(m.SalaryStructure, pk=pk), request.user, request.data.get("reason", "")
        )
        return self.ok(s.SalaryStructureSerializer(structure).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        structure = svc.deactivate_structure(
            self.get_or_404(m.SalaryStructure, pk=pk), request.user, request.data.get("reason", "")
        )
        return self.ok(s.SalaryStructureSerializer(structure).data)

    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None):
        source = self.get_or_404(m.SalaryStructure, pk=pk)
        code, name = request.data.get("code"), request.data.get("name")
        if not code or not name:
            raise invalid("Code and name are required for the copy.")
        structure = svc.clone_structure(source, request.user, code, name)
        return self.ok(s.SalaryStructureSerializer(structure).data, status=201)

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        structure = self.get_or_404(m.SalaryStructure, pk=pk)
        return self.ok(
            {
                "versions": s.StructureVersionSerializer(structure.versions.all(), many=True).data,
                "audit": _history("SalaryStructure", structure.pk),
            }
        )

    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        structure = self.get_or_404(m.SalaryStructure, pk=pk)
        ctc = request.query_params.get("ctc") or structure.reference_ctc
        return self.ok(
            svc.preview_structure(svc.live_lines(structure), ctc, tolerance=structure.ctc_tolerance)
        )

    @action(detail=False, methods=["post"], url_path="preview")
    def preview_draft(self, request):
        """Live builder preview for unsaved lines (UI 05)."""
        lines = svc.draft_lines(request.data.get("lines", []))
        return self.ok(
            svc.preview_structure(
                lines,
                request.data.get("annual_ctc") or 0,
                tolerance=request.data.get("ctc_tolerance") or 1,
            )
        )


class StatutoryRuleViewSet(PayrollViewSet):
    queryset = m.StatutoryRule.objects.all()
    required_permission = "payroll.manage"
    action_permissions = {
        "list": "payroll.manage",
        "create": "payroll.manage",
        "partial_update": "payroll.manage",
        "review": "payroll.approve",
    }
    any_permissions = {"list": CONFIG_READERS}

    def list(self, request):
        return self.ok(s.StatutoryRuleSerializer(m.StatutoryRule.objects.all(), many=True).data)

    def create(self, request):
        ser = s.StatutoryRuleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rule = ser.save(created_by=request.user, updated_by=request.user)
        audit(request.user, "statutory_rule.created", rule, changes={"new": snapshot(rule)})
        return self.ok(s.StatutoryRuleSerializer(rule).data, status=201)

    def partial_update(self, request, pk=None):
        rule = self.get_or_404(m.StatutoryRule, pk=pk)
        check_version(rule, request.data.get("version"))
        before = snapshot(rule)
        ser = s.StatutoryRuleSerializer(rule, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        rule = ser.save(
            updated_by=request.user,
            version=rule.version + 1,
            is_reviewed=False,
            reviewed_at=None,
            reviewed_by=None,
        )
        audit(
            request.user,
            "statutory_rule.updated",
            rule,
            changes=diff(before, snapshot(rule)),
            reason=request.data.get("reason", ""),
        )
        return self.ok(s.StatutoryRuleSerializer(rule).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Payroll/compliance owner sign-off (PRD §16)."""
        from django.utils import timezone

        rule = self.get_or_404(m.StatutoryRule, pk=pk)
        rule.is_reviewed = True
        rule.reviewed_by = request.user
        rule.reviewed_at = timezone.now()
        rule.save()
        audit(request.user, "statutory_rule.reviewed", rule, reason=request.data.get("note", ""))
        return self.ok(s.StatutoryRuleSerializer(rule).data)


class PayGroupViewSet(PayrollViewSet):
    queryset = m.PayGroup.objects.all()
    required_permission = "payroll.manage"
    action_permissions = {
        "list": "payroll.manage",
        "create": "payroll.manage",
        "partial_update": "payroll.manage",
    }
    any_permissions = {"list": CONFIG_READERS + ("payroll.read",)}

    def list(self, request):
        return self.ok(
            s.PayGroupSerializer(m.PayGroup.objects.select_related("legal_entity"), many=True).data
        )

    def create(self, request):
        ser = s.PayGroupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        group = ser.save(created_by=request.user, updated_by=request.user)
        audit(request.user, "pay_group.created", group, changes={"new": snapshot(group)})
        return self.ok(s.PayGroupSerializer(group).data, status=201)

    def partial_update(self, request, pk=None):
        group = self.get_or_404(m.PayGroup, pk=pk)
        check_version(group, request.data.get("version"))
        before = snapshot(group)
        ser = s.PayGroupSerializer(group, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        group = ser.save(updated_by=request.user, version=group.version + 1)
        audit(request.user, "pay_group.updated", group, changes=diff(before, snapshot(group)))
        return self.ok(s.PayGroupSerializer(group).data)
