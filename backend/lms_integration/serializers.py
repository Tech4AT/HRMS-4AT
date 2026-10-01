from rest_framework import serializers

from lms_integration.models import (
    AssessmentResult,
    EmployeeCertification,
    EmployeeSkill,
    IntegrationDelivery,
    IntegrationEvent,
    LearningEnrollment,
    LmsIdentityLink,
    ReconciliationRun,
)
from lms_integration.summary import certification_state


class EnrollmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningEnrollment
        fields = [
            "id",
            "employee",
            "course_id",
            "title",
            "category",
            "path_id",
            "path_name",
            "mandatory",
            "status",
            "progress",
            "assigned_at",
            "due_at",
            "completed_at",
            "score",
            "updated_at",
        ]


class AssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentResult
        fields = [
            "id",
            "employee",
            "assessment_id",
            "title",
            "course_id",
            "status",
            "score",
            "max_score",
            "completed_at",
            "updated_at",
        ]


class CertificationSerializer(serializers.ModelSerializer):
    # The displayed status accounts for expiry dates HRMS can see itself.
    status = serializers.SerializerMethodField()
    lms_status = serializers.CharField(source="status", read_only=True)

    class Meta:
        model = EmployeeCertification
        fields = [
            "id",
            "employee",
            "certification_id",
            "name",
            "issued_at",
            "expires_at",
            "status",
            "lms_status",
            "credential_url",
            "updated_at",
        ]

    def get_status(self, obj):
        return certification_state(obj)


class SkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeSkill
        fields = [
            "id",
            "employee",
            "skill_id",
            "name",
            "proficiency",
            "proficiency_score",
            "evidence_refs",
            "updated_at",
        ]


class LinkSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_status = serializers.CharField(source="employee.status", read_only=True)

    class Meta:
        model = LmsIdentityLink
        fields = [
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "employee_status",
            "learner_id",
            "status",
            "linked_at",
            "last_synced_at",
            "last_error",
            "updated_at",
        ]


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = IntegrationDelivery
        fields = [
            "attempt_no",
            "target",
            "succeeded",
            "http_status",
            "error",
            "duration_ms",
            "attempted_at",
        ]


class EventSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(
        source="employee.employee_code", read_only=True, default=None
    )
    employee_name = serializers.CharField(source="employee.full_name", read_only=True, default=None)

    class Meta:
        model = IntegrationEvent
        fields = [
            "id",
            "event_id",
            "event_type",
            "schema_version",
            "direction",
            "source",
            "correlation_id",
            "employee",
            "employee_code",
            "employee_name",
            "status",
            "attempt_count",
            "next_attempt_at",
            "last_error",
            "occurred_at",
            "processed_at",
            "created_at",
            "updated_at",
        ]


class EventDetailSerializer(EventSerializer):
    deliveries = DeliverySerializer(many=True, read_only=True)

    class Meta(EventSerializer.Meta):
        fields = EventSerializer.Meta.fields + ["payload", "deliveries"]


class ReconciliationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReconciliationRun
        fields = [
            "id",
            "trigger",
            "status",
            "provision",
            "summary",
            "error",
            "started_at",
            "finished_at",
            "started_by",
        ]


class ReconciliationRunDetailSerializer(ReconciliationRunSerializer):
    class Meta(ReconciliationRunSerializer.Meta):
        fields = ReconciliationRunSerializer.Meta.fields + ["findings"]


class LinkRequestSerializer(serializers.Serializer):
    employee_id = serializers.IntegerField()
    learner_id = serializers.CharField(max_length=64, required=False, allow_blank=True)


class ReconcileRequestSerializer(serializers.Serializer):
    provision = serializers.BooleanField(default=False)


class SsoLaunchSerializer(serializers.Serializer):
    target = serializers.CharField(max_length=500, required=False, allow_blank=True)
