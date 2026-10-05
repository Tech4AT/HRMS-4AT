"""Payroll API serializers. Responses are snake_case inside the core's
`{success, data}` envelope; money is serialized as decimal strings (API
contract §3: never binary floating point)."""

from rest_framework import serializers

from employees.models import Employee, LegalEntity

from . import models as m
from .services.common import employee_card


class UserNameField(serializers.Field):
    def to_representation(self, user):
        if user is None:
            return None
        return {"id": user.pk, "name": user.get_full_name() or user.email}

    def to_internal_value(self, data):
        raise serializers.ValidationError("Read-only.")


def _user(field):
    """A read-only {id, name} for a user FK; `field` documents the FK name."""
    return UserNameField(read_only=True)


class PayGroupSerializer(serializers.ModelSerializer):
    legal_entity = serializers.PrimaryKeyRelatedField(queryset=LegalEntity.objects.all())
    legal_entity_name = serializers.CharField(source="legal_entity.name", read_only=True)
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = m.PayGroup
        exclude = ["created_by", "updated_by", "pay_schedule"]
        read_only_fields = ["version", "created_at", "updated_at"]

    def get_employee_count(self, obj):
        return m.EmployeePayrollProfile.objects.filter(
            pay_group=obj, effective_to__isnull=True
        ).count()


class SalaryComponentSerializer(serializers.ModelSerializer):
    created_by = _user("created_by")
    updated_by = _user("updated_by")
    structures = serializers.SerializerMethodField()

    class Meta:
        model = m.SalaryComponent
        fields = "__all__"
        read_only_fields = ["version", "created_at", "updated_at"]

    def get_structures(self, obj):
        return list(
            m.SalaryStructure.objects.filter(lines__component=obj)
            .distinct()
            .values_list("code", flat=True)
        )


class ComponentWriteSerializer(serializers.ModelSerializer):
    version = serializers.IntegerField(required=False)

    class Meta:
        model = m.SalaryComponent
        exclude = ["id", "created_by", "updated_by", "created_at", "updated_at"]
        extra_kwargs = {"code": {"validators": []}, "status": {"required": False}}


class ComponentVersionSerializer(serializers.ModelSerializer):
    created_by = _user("created_by")

    class Meta:
        model = m.SalaryComponentVersion
        fields = [
            "id",
            "version",
            "effective_from",
            "config",
            "change_reason",
            "created_by",
            "created_at",
        ]


class StructureLineSerializer(serializers.ModelSerializer):
    component_code = serializers.CharField(source="component.code", read_only=True)
    component_name = serializers.CharField(source="component.name", read_only=True)
    component_type = serializers.CharField(source="component.component_type", read_only=True)
    component_status = serializers.CharField(source="component.status", read_only=True)
    default_calculation_type = serializers.CharField(
        source="component.calculation_type", read_only=True
    )
    default_value = serializers.DecimalField(
        source="component.value", max_digits=18, decimal_places=4, read_only=True
    )

    class Meta:
        model = m.SalaryStructureComponent
        fields = [
            "id",
            "component",
            "component_code",
            "component_name",
            "component_type",
            "component_status",
            "order",
            "calculation_type",
            "value",
            "base_component_code",
            "formula_expr",
            "is_mandatory",
            "default_calculation_type",
            "default_value",
        ]


class SalaryStructureSerializer(serializers.ModelSerializer):
    lines = StructureLineSerializer(many=True, read_only=True)
    legal_entity_name = serializers.CharField(
        source="legal_entity.name", read_only=True, default=""
    )
    pay_group_name = serializers.CharField(source="pay_group.name", read_only=True, default="")
    employee_count = serializers.SerializerMethodField()
    created_by = _user("created_by")
    updated_by = _user("updated_by")

    class Meta:
        model = m.SalaryStructure
        fields = "__all__"

    def get_employee_count(self, obj):
        return m.EmployeeCompensation.objects.filter(
            structure=obj, status="active", effective_to__isnull=True
        ).count()


class StructureWriteSerializer(serializers.ModelSerializer):
    version = serializers.IntegerField(required=False)
    lines = serializers.ListField(child=serializers.DictField(), required=False)
    legal_entity = serializers.PrimaryKeyRelatedField(
        queryset=LegalEntity.objects.all(), required=False, allow_null=True
    )
    pay_group = serializers.PrimaryKeyRelatedField(
        queryset=m.PayGroup.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = m.SalaryStructure
        exclude = ["id", "created_by", "updated_by", "created_at", "updated_at"]
        extra_kwargs = {"code": {"validators": []}, "status": {"required": False}}


class StructureVersionSerializer(serializers.ModelSerializer):
    created_by = _user("created_by")

    class Meta:
        model = m.SalaryStructureVersion
        fields = [
            "id",
            "version",
            "effective_from",
            "snapshot",
            "change_reason",
            "created_by",
            "created_at",
        ]


class StatutoryRuleSerializer(serializers.ModelSerializer):
    reviewed_by = _user("reviewed_by")
    legal_entity = serializers.PrimaryKeyRelatedField(
        queryset=LegalEntity.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = m.StatutoryRule
        exclude = ["created_by", "updated_by"]
        read_only_fields = ["version", "is_reviewed", "reviewed_at", "created_at", "updated_at"]


class ProfileSerializer(serializers.ModelSerializer):
    pay_group_name = serializers.CharField(source="pay_group.name", read_only=True, default="")
    updated_by = _user("updated_by")

    class Meta:
        model = m.EmployeePayrollProfile
        exclude = ["created_by"]


class ProfileWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(required=False)
    effective_from = serializers.DateField(required=False)
    pay_group = serializers.PrimaryKeyRelatedField(
        queryset=m.PayGroup.objects.all(), required=False, allow_null=True
    )
    payroll_status = serializers.ChoiceField(
        m.EmployeePayrollProfile.STATUS_CHOICES, required=False
    )
    work_state = serializers.CharField(required=False, allow_blank=True)
    tax_regime = serializers.ChoiceField(m.EmployeePayrollProfile.REGIME_CHOICES, required=False)
    pf_applicable = serializers.BooleanField(required=False)
    esi_applicable = serializers.BooleanField(required=False)
    pt_applicable = serializers.BooleanField(required=False)
    lwf_applicable = serializers.BooleanField(required=False)
    payment_mode = serializers.ChoiceField(
        m.EmployeePayrollProfile.PAYMENT_MODE_CHOICES, required=False
    )
    payroll_start_date = serializers.DateField(required=False, allow_null=True)
    payroll_end_date = serializers.DateField(required=False, allow_null=True)
    remarks = serializers.CharField(required=False, allow_blank=True)


class CompensationSerializer(serializers.ModelSerializer):
    structure_code = serializers.CharField(source="structure.code", read_only=True)
    structure_name = serializers.CharField(source="structure.name", read_only=True)
    approved_by = _user("approved_by")
    created_by = _user("created_by")

    class Meta:
        model = m.EmployeeCompensation
        fields = "__all__"


class ApprovalSerializer(serializers.ModelSerializer):
    approver = _user("approver")
    stage_label = serializers.CharField(source="get_stage_display", read_only=True)

    class Meta:
        model = m.PayrollApproval
        fields = [
            "id",
            "stage",
            "stage_label",
            "sequence",
            "status",
            "approver",
            "comments",
            "acted_at",
        ]


class RevisionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    structure_code = serializers.CharField(source="structure.code", read_only=True)
    structure_name = serializers.CharField(source="structure.name", read_only=True)
    current_compensation = CompensationSerializer(read_only=True)
    approvals = serializers.SerializerMethodField()
    created_by = _user("created_by")
    type_label = serializers.CharField(source="get_revision_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = m.CompensationRevision
        fields = "__all__"

    def get_employee(self, obj):
        return employee_card(obj.employee)

    def get_approvals(self, obj):
        return ApprovalSerializer(
            obj.approvals.exclude(status="cancelled").order_by("sequence"), many=True
        ).data


class RevisionWriteSerializer(serializers.Serializer):
    version = serializers.IntegerField(required=False)
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), required=False)
    structure = serializers.PrimaryKeyRelatedField(queryset=m.SalaryStructure.objects.all())
    annual_ctc = serializers.DecimalField(max_digits=14, decimal_places=2)
    effective_from = serializers.DateField()
    revision_type = serializers.ChoiceField(m.CompensationRevision.TYPE_CHOICES, required=False)
    reason = serializers.CharField(required=False, allow_blank=True)
    remarks = serializers.CharField(required=False, allow_blank=True)
    submit = serializers.BooleanField(required=False, default=False)


class PeriodSerializer(serializers.ModelSerializer):
    pay_group_name = serializers.CharField(source="pay_group.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    is_locked = serializers.BooleanField(read_only=True)
    current_run = serializers.SerializerMethodField()
    finalized_by = _user("finalized_by")
    completed_by = _user("completed_by")

    class Meta:
        model = m.PayrollPeriod
        exclude = ["created_by", "updated_by"]

    def get_current_run(self, obj):
        run = obj.runs.filter(is_current=True).order_by("-run_no").first()
        if run is None:
            return None
        return {"id": str(run.pk), "run_no": run.run_no, "status": run.status}


class AttendanceSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()

    class Meta:
        model = m.AttendancePayrollInput
        exclude = ["updated_by"]

    def get_employee(self, obj):
        return employee_card(obj.employee)


class InputSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    component_code = serializers.CharField(source="component.code", read_only=True)
    component_name = serializers.CharField(source="component.name", read_only=True)
    type_label = serializers.CharField(source="get_input_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    approved_by = _user("approved_by")
    created_by = _user("created_by")

    class Meta:
        model = m.PayrollInput
        exclude = ["updated_by"]

    def get_employee(self, obj):
        return employee_card(obj.employee)


class InputWriteSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), required=False)
    input_type = serializers.ChoiceField(m.PayrollInput.TYPE_CHOICES, required=False)
    component = serializers.PrimaryKeyRelatedField(
        queryset=m.SalaryComponent.objects.all(), required=False
    )
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    units = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, allow_null=True
    )
    rate = serializers.DecimalField(
        max_digits=18, decimal_places=4, required=False, allow_null=True
    )
    reason = serializers.CharField(required=False, allow_blank=True)
    remarks = serializers.CharField(required=False, allow_blank=True)
    reference_period = serializers.CharField(required=False, allow_blank=True)
    expense_date = serializers.DateField(required=False, allow_null=True)
    source_batch_id = serializers.CharField(required=False, allow_blank=True)
    source_row_key = serializers.CharField(required=False, allow_blank=True)


class ResultLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.PayrollResultComponent
        exclude = ["result"]


class ExceptionSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    acknowledged_by = _user("acknowledged_by")

    class Meta:
        model = m.PayrollException
        exclude = ["run"]

    def get_employee(self, obj):
        if obj.result_id:
            snap = obj.result.employee_snapshot
            return {
                "id": obj.employee_id,
                "name": snap.get("name"),
                "employee_code": snap.get("employee_code"),
            }
        return None


class ResultSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    exception_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = m.EmployeePayrollResult
        exclude = ["run", "segments"]

    def get_employee(self, obj):
        return {**obj.employee_snapshot, "id": obj.employee_id}


class ResultDetailSerializer(ResultSerializer):
    lines = ResultLineSerializer(many=True, read_only=True)
    exceptions = ExceptionSerializer(many=True, read_only=True)
    run = serializers.SerializerMethodField()

    class Meta:
        model = m.EmployeePayrollResult
        fields = "__all__"

    def get_run(self, obj):
        run = obj.run
        return {
            "id": str(run.pk),
            "run_no": run.run_no,
            "status": run.status,
            "period_id": str(run.period_id),
            "input_snapshot_id": run.input_snapshot_id,
            "configuration_snapshot_id": run.configuration_snapshot_id,
            "engine_version": run.engine_version,
            "calculated_at": run.calculated_at.isoformat() if run.calculated_at else None,
        }


class RunSerializer(serializers.ModelSerializer):
    approvals = serializers.SerializerMethodField()
    created_by = _user("created_by")
    submitted_by = _user("submitted_by")
    finalized_by = _user("finalized_by")
    reopened_by = _user("reopened_by")
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = m.PayrollRun
        exclude = ["configuration_snapshot"]

    def get_approvals(self, obj):
        return ApprovalSerializer(
            obj.approvals.exclude(status="cancelled").order_by("sequence"), many=True
        ).data


class PayslipSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    period_label = serializers.SerializerMethodField()

    class Meta:
        model = m.Payslip
        fields = [
            "id",
            "employee",
            "period",
            "period_label",
            "version",
            "status",
            "net_pay",
            "generated_at",
            "released_at",
            "payload",
        ]

    def get_employee(self, obj):
        return obj.result.employee_snapshot

    def get_period_label(self, obj):
        return obj.payload.get("period", {}).get("label", "")


class PayslipListSerializer(PayslipSerializer):
    class Meta(PayslipSerializer.Meta):
        fields = [
            "id",
            "employee",
            "period",
            "period_label",
            "version",
            "status",
            "net_pay",
            "generated_at",
            "released_at",
        ]


class OutputSerializer(serializers.ModelSerializer):
    generated_by = _user("generated_by")
    paid_by = _user("paid_by")
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = m.PayrollOutput
        exclude = ["content"]


class OverrideSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    component_code = serializers.CharField(source="component.code", read_only=True)
    created_by = _user("created_by")

    class Meta:
        model = m.PayrollOverride
        fields = "__all__"

    def get_employee(self, obj):
        return employee_card(obj.employee)


# Legacy setup/inputs screens kept from the original module.
class EmployeePaymentInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.EmployeePaymentInfo
        fields = "__all__"


class LoanSerializer(serializers.ModelSerializer):
    employee_card = serializers.SerializerMethodField()
    component_code = serializers.CharField(source="component.code", read_only=True, default="")

    class Meta:
        model = m.EmployeeDeduction
        fields = "__all__"

    def get_employee_card(self, obj):
        return employee_card(obj.employee)


class LegalEntityPayrollProfileSerializer(serializers.ModelSerializer):
    legal_entity_name = serializers.CharField(source="legal_entity.name", read_only=True)

    class Meta:
        model = m.LegalEntityPayrollProfile
        fields = "__all__"
