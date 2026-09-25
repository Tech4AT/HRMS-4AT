from rest_framework import serializers

from attendance.models import AttendanceRecord, AttendanceRequest, AttendanceRequestStatus


def _display_name(employee) -> str:
    if employee is None:
        return ""
    return employee.user.get_full_name() or employee.user.get_username()


class AttendanceRecordSerializer(serializers.ModelSerializer):
    # No multi-tenant/Organization model exists in this codebase (employees'
    # LegalEntity is explicitly single-row today) — 'org-1' matches the retired
    # mock backend's constant so the frontend's (otherwise unused, confirmed via
    # grep) `organization_id` field keeps its shape without inventing real
    # multi-tenant infrastructure nothing else needs.
    # `lib/api/attendance.ts` types both `id` and `employee_id` as `string` —
    # this app's pks are plain BigAutoField integers, so both are cast
    # explicitly rather than left as the bare ints DRF would otherwise emit.
    id = serializers.SerializerMethodField()
    organization_id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    break_minutes = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            "id",
            "organization_id",
            "employee_id",
            "attendance_date",
            "clock_in_time",
            "clock_out_time",
            "working_minutes",
            "break_minutes",
            "late_minutes",
            "early_leave_minutes",
            "status",
            "source",
            "notes",
            "marked_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [f for f in fields if f != "notes"]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_organization_id(self, obj) -> str:
        return "org-1"

    def get_employee_id(self, obj) -> str:
        return str(obj.employee_id)

    def get_break_minutes(self, obj) -> int:
        return sum(b.minutes for b in obj.breaks.all())


class AttendanceRequestSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    # The generic approvals.Request this row raised — not itself part of the
    # decision path (this app never decides one), but the frontend's Approvals
    # review UI needs it to call the *generic* /api/requests/{id}/approve|reject
    # endpoint for the row it's showing from this module's own pending list.
    approval_request_id = serializers.SerializerMethodField()
    approver_id = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    # Who actually decided this — usually the same person as approver_name,
    # but not when an HR Admin resolves it via the approvals.manage override
    # (approvals.service.resolve) rather than the assigned approver deciding
    # it themselves. approver_name/_id stay the routing target (needed by the
    # frontend to know whether *it* can approve/reject directly, or must use
    # the override); this is who to actually credit in a decided-requests view.
    decided_by_name = serializers.SerializerMethodField()
    approved_at = serializers.SerializerMethodField()
    cancelled_at = serializers.SerializerMethodField()
    rejection_reason = serializers.SerializerMethodField()
    approver_remarks = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRequest
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "request_type",
            "start_date",
            "end_date",
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
        read_only_fields = [
            "id",
            "employee_id",
            "employee_name",
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

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_employee_id(self, obj) -> str:
        return str(obj.employee_id)

    def get_approval_request_id(self, obj):
        return str(obj.approval_request_id) if obj.approval_request_id else None

    def get_employee_name(self, obj) -> str:
        return _display_name(obj.employee)

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
        if obj.status == AttendanceRequestStatus.APPROVED:
            return obj.decided_at
        return None

    def get_cancelled_at(self, obj):
        if obj.status == AttendanceRequestStatus.CANCELLED:
            return obj.decided_at
        return None

    def get_rejection_reason(self, obj):
        req = obj.approval_request
        if obj.status == AttendanceRequestStatus.REJECTED and req:
            return req.decision_note or None
        return None

    def get_approver_remarks(self, obj):
        req = obj.approval_request
        return req.decision_note or None if req else None
