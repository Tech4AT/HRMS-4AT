"""PLAN.md Step 8. `lib/attendance/penalisation.ts`'s `PenalisationRecord` type
is camelCase and, being sample-only until now, has no existing wire contract
to preserve — same situation Shift/PolicySettings (Step 6) and the Leave
Balances admin view (Step 7) were in, so this uses the project's default
camelCase renderer/parser instead of forcing snake_case. `employee_id` is a
new field the sample data never needed (nothing real to scope against); every
other field matches the frontend's existing names exactly."""

from rest_framework import serializers

from .models import PenalisationRecord
from .serializers import _display_name


class PenalisationRecordSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    overturned_by = serializers.SerializerMethodField()

    class Meta:
        model = PenalisationRecord
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "absent_date",
            "regularisation_deadline",
            "days_overdue",
            "reason",
            "status",
            "leave_days_deducted",
            "overturned_by",
            "overturned_reason",
        ]
        read_only_fields = fields

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_employee_id(self, obj) -> str:
        return str(obj.employee_id)

    def get_employee_name(self, obj) -> str:
        return _display_name(obj.employee)

    def get_overturned_by(self, obj) -> str | None:
        return _display_name(obj.overturned_by) if obj.overturned_by_id else None
