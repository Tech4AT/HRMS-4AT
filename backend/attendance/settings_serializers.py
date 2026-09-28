"""Serializers for the two Step 6 config resources (Shifts, Policy Settings).
Kept in a separate module from serializers.py, which is entirely about the
self-service check-in/request flow — these are org-admin configuration, a
different concern (PLAN.md Step 6)."""

from rest_framework import serializers

from employees.models import Employee
from leave.models import LeaveType, LeaveTypeStatus

from .models import PolicySettings, Shift


class ShiftSerializer(serializers.ModelSerializer):
    # `lib/attendance/shifts.ts`'s Shift has no existing API client (still
    # local component state) — normal snake_case + the project's default
    # CamelCase renderer already produce its exact field names, so nothing
    # here needs the snake_case-preserving EnvelopeMixin org_calendar/
    # attendance/leave use to match an *existing* wire contract.
    id = serializers.SerializerMethodField()
    start_time = serializers.TimeField(format="%H:%M", input_formats=["%H:%M"])
    end_time = serializers.TimeField(format="%H:%M", input_formats=["%H:%M"])
    employee_ids = serializers.PrimaryKeyRelatedField(
        source="employees",
        many=True,
        queryset=Employee.objects.all(),
        required=False,
        pk_field=serializers.CharField(),
    )

    class Meta:
        model = Shift
        fields = [
            "id",
            "name",
            "start_time",
            "end_time",
            "break_minutes",
            "employee_ids",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)


class RuleConfigSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    leave_days_deducted = serializers.DecimalField(max_digits=4, decimal_places=1)
    threshold_count = serializers.IntegerField(required=False, allow_null=True)
    min_work_hours = serializers.DecimalField(
        max_digits=4, decimal_places=1, required=False, allow_null=True
    )


class CompOffAccrualSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    overtime_hours_per_comp_off = serializers.DecimalField(max_digits=5, decimal_places=1)


class PolicySettingsSerializer(serializers.Serializer):
    """Plain Serializer, not ModelSerializer — the frontend's shape is nested
    (`noAttendance: {enabled, leaveDaysDeducted}`) but the model is flat
    (`no_attendance_enabled`, `no_attendance_leave_days_deducted`); `Meta.model`
    field-name mapping can't express that, so representation/validation are
    both written out by hand instead."""

    regularisation_grace_days = serializers.IntegerField(min_value=1)
    absconding_threshold_days = serializers.IntegerField(min_value=1)
    # The one leave type every enabled rule below deducts from — shared, not
    # one per rule, per direct instruction. Null means "not configured yet";
    # `apply_penalisations()` then skips the deduction entirely.
    penalty_leave_type_id = serializers.PrimaryKeyRelatedField(
        source="penalty_leave_type",
        queryset=LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE),
        pk_field=serializers.CharField(),
        allow_null=True,
    )
    # Symmetric with penalty_leave_type_id, opposite direction: the leave
    # type a credited Comp Off actually lands in (`comp_off.py`). Null means
    # "not configured yet" — the accrual tally still runs, but nothing is
    # ever credited until HR sets one.
    comp_off_leave_type_id = serializers.PrimaryKeyRelatedField(
        source="comp_off_leave_type",
        queryset=LeaveType.objects.filter(status=LeaveTypeStatus.ACTIVE),
        pk_field=serializers.CharField(),
        allow_null=True,
    )
    no_attendance = RuleConfigSerializer()
    late_arrival = RuleConfigSerializer()
    early_leaving = RuleConfigSerializer()
    work_hours = RuleConfigSerializer()
    comp_off_accrual = CompOffAccrualSerializer()

    def to_representation(self, instance: PolicySettings) -> dict:
        # Routed through the declared nested serializers' own
        # to_representation (not a hand-built dict of raw model values) so
        # their DecimalFields actually stringify — a raw Decimal slipping
        # through here isn't just a display bug, it's a hard crash the moment
        # it reaches an audit-log JSONField write (found by the test suite:
        # psycopg's JSON encoder doesn't know what a Decimal is either).
        return {
            "regularisation_grace_days": instance.regularisation_grace_days,
            "absconding_threshold_days": instance.absconding_threshold_days,
            "penalty_leave_type_id": (
                str(instance.penalty_leave_type_id) if instance.penalty_leave_type_id else None
            ),
            "comp_off_leave_type_id": (
                str(instance.comp_off_leave_type_id) if instance.comp_off_leave_type_id else None
            ),
            "no_attendance": RuleConfigSerializer(
                {
                    "enabled": instance.no_attendance_enabled,
                    "leave_days_deducted": instance.no_attendance_leave_days_deducted,
                }
            ).data,
            "late_arrival": RuleConfigSerializer(
                {
                    "enabled": instance.late_arrival_enabled,
                    "leave_days_deducted": instance.late_arrival_leave_days_deducted,
                    "threshold_count": instance.late_arrival_threshold_count,
                }
            ).data,
            "early_leaving": RuleConfigSerializer(
                {
                    "enabled": instance.early_leaving_enabled,
                    "leave_days_deducted": instance.early_leaving_leave_days_deducted,
                    "threshold_count": instance.early_leaving_threshold_count,
                }
            ).data,
            "work_hours": RuleConfigSerializer(
                {
                    "enabled": instance.work_hours_enabled,
                    "leave_days_deducted": instance.work_hours_leave_days_deducted,
                    "min_work_hours": instance.work_hours_min_work_hours,
                }
            ).data,
            "comp_off_accrual": CompOffAccrualSerializer(
                {
                    "enabled": instance.comp_off_accrual_enabled,
                    "overtime_hours_per_comp_off": (
                        instance.comp_off_accrual_overtime_hours_per_comp_off
                    ),
                }
            ).data,
        }

    def update(self, instance: PolicySettings, validated_data: dict) -> PolicySettings:
        instance.regularisation_grace_days = validated_data["regularisation_grace_days"]
        instance.absconding_threshold_days = validated_data["absconding_threshold_days"]
        instance.penalty_leave_type = validated_data["penalty_leave_type"]
        instance.comp_off_leave_type = validated_data["comp_off_leave_type"]

        na = validated_data["no_attendance"]
        instance.no_attendance_enabled = na["enabled"]
        instance.no_attendance_leave_days_deducted = na["leave_days_deducted"]

        la = validated_data["late_arrival"]
        instance.late_arrival_enabled = la["enabled"]
        instance.late_arrival_leave_days_deducted = la["leave_days_deducted"]
        if la.get("threshold_count") is not None:
            instance.late_arrival_threshold_count = la["threshold_count"]

        el = validated_data["early_leaving"]
        instance.early_leaving_enabled = el["enabled"]
        instance.early_leaving_leave_days_deducted = el["leave_days_deducted"]
        if el.get("threshold_count") is not None:
            instance.early_leaving_threshold_count = el["threshold_count"]

        wh = validated_data["work_hours"]
        instance.work_hours_enabled = wh["enabled"]
        instance.work_hours_leave_days_deducted = wh["leave_days_deducted"]
        if wh.get("min_work_hours") is not None:
            instance.work_hours_min_work_hours = wh["min_work_hours"]

        coa = validated_data["comp_off_accrual"]
        instance.comp_off_accrual_enabled = coa["enabled"]
        instance.comp_off_accrual_overtime_hours_per_comp_off = coa["overtime_hours_per_comp_off"]

        instance.save()
        return instance
