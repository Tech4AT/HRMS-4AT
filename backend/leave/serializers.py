from rest_framework import serializers

from .models import LeaveBalance, LeaveRequest, LeaveRequestStatus, LeaveType


def _display_name(employee) -> str:
    if employee is None:
        return ""
    return employee.user.get_full_name() or employee.user.get_username()


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = [
            "id",
            "name",
            "code",
            "category",
            "annual_allocation",
            "carry_forward_limit",
            "requires_approval",
            "is_paid",
            "description",
            "status",
        ]
        read_only_fields = ["id", "code", "status"]


class LeaveBalanceSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    leave_type_id = serializers.SerializerMethodField()
    entitled = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)
    available = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)

    class Meta:
        model = LeaveBalance
        fields = [
            "id",
            "leave_type_id",
            "financial_year",
            "opening_balance",
            "allocated",
            "used",
            "pending",
            "carry_forward",
            "lapsed",
            "entitled",
            "available",
        ]
        read_only_fields = fields

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_leave_type_id(self, obj) -> str:
        return str(obj.leave_type_id)


class LeaveRequestSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    leave_type_id = serializers.SerializerMethodField()
    leave_type_name = serializers.SerializerMethodField()
    leave_type_code = serializers.SerializerMethodField()
    duration_days = serializers.DecimalField(max_digits=5, decimal_places=1, read_only=True)
    # See attendance/serializers.py's AttendanceRequestSerializer — same
    # reasoning: the frontend's Approvals review UI needs this to decide
    # through the generic engine from this module's own pending list.
    approval_request_id = serializers.SerializerMethodField()
    approver_id = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    # Who actually decided this — see attendance/serializers.py's identical
    # field for why it's not always the same as approver_name (the
    # approvals.manage resolve override).
    decided_by_name = serializers.SerializerMethodField()
    approved_at = serializers.SerializerMethodField()
    cancelled_at = serializers.SerializerMethodField()
    rejection_reason = serializers.SerializerMethodField()
    approver_remarks = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "leave_type_id",
            "leave_type_name",
            "leave_type_code",
            "start_date",
            "end_date",
            "duration_days",
            "half_day_option",
            "reason",
            "status",
            "approval_request_id",
            "approver_id",
            "approver_name",
            "decided_by_name",
            "approved_at",
            "rejection_reason",
            "cancelled_at",
            "approver_remarks",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [f for f in fields if f not in ("half_day_option",)]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_employee_id(self, obj) -> str:
        return str(obj.employee_id)

    def get_employee_name(self, obj) -> str:
        return _display_name(obj.employee)

    def get_approval_request_id(self, obj):
        return str(obj.approval_request_id) if obj.approval_request_id else None

    def get_leave_type_id(self, obj) -> str:
        return str(obj.leave_type_id)

    def get_leave_type_name(self, obj):
        return obj.leave_type.name if obj.leave_type_id else None

    def get_leave_type_code(self, obj):
        return obj.leave_type.code if obj.leave_type_id else None

    def get_approver_id(self, obj):
        req = obj.approval_request
        return str(req.approver_id) if req and req.approver_id else None

    def get_approver_name(self, obj):
        req = obj.approval_request
        if not req or not req.approver_id:
            return None
        return _display_name(getattr(req.approver, "employee", None)) or req.approver.get_username()

    def get_decided_by_name(self, obj):
        req = obj.approval_request
        if not req or not req.decided_by_id:
            return None
        return (
            _display_name(getattr(req.decided_by, "employee", None))
            or req.decided_by.get_username()
        )

    def get_approved_at(self, obj):
        return obj.decided_at if obj.status == LeaveRequestStatus.APPROVED else None

    def get_cancelled_at(self, obj):
        return obj.decided_at if obj.status == LeaveRequestStatus.CANCELLED else None

    def get_rejection_reason(self, obj):
        req = obj.approval_request
        if obj.status == LeaveRequestStatus.REJECTED and req:
            return req.decision_note or None
        return None

    def get_approver_remarks(self, obj):
        req = obj.approval_request
        return (req.decision_note or None) if req else None
