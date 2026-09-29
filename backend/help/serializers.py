from rest_framework import serializers

from .models import CategoryAssignment, Ticket, TicketActivity, TicketCategory, TicketPriority


def _display_name(employee) -> str:
    if employee is None:
        return ""
    return employee.user.get_full_name() or employee.user.get_username()


class TicketActivitySerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = TicketActivity
        fields = [
            "id",
            "event_type",
            "previous_status",
            "new_status",
            "comment",
            "actor_name",
            "created_at",
        ]
        read_only_fields = fields

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_actor_name(self, obj):
        if obj.actor_id is None:
            return None
        return _display_name(getattr(obj.actor, "employee", None)) or obj.actor.get_username()


class TicketSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    assigned_to_id = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()
    activities = TicketActivitySerializer(many=True, read_only=True)
    # `lib/api/help.ts` types subject/description with a minimum length; the
    # model itself has no MinLengthValidator, so it's enforced here rather
    # than duplicated as a DB constraint (ESSL's own 2-char minimum).
    subject = serializers.CharField(min_length=2, max_length=255)
    description = serializers.CharField(min_length=2, max_length=5000)
    category = serializers.ChoiceField(choices=TicketCategory.choices)
    priority = serializers.ChoiceField(choices=TicketPriority.choices)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "subject",
            "description",
            "category",
            "priority",
            "status",
            "assigned_to_id",
            "assigned_to_name",
            "admin_comment",
            "reopen_count",
            "escalation_level",
            "created_at",
            "updated_at",
            "activities",
        ]
        read_only_fields = [
            "id",
            "employee_id",
            "employee_name",
            "status",
            "assigned_to_id",
            "assigned_to_name",
            "admin_comment",
            "reopen_count",
            "escalation_level",
            "created_at",
            "updated_at",
            "activities",
        ]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_employee_id(self, obj) -> str:
        return str(obj.employee_id)

    def get_employee_name(self, obj) -> str:
        return _display_name(obj.employee)

    def get_assigned_to_id(self, obj):
        return str(obj.assigned_to_id) if obj.assigned_to_id else None

    def get_assigned_to_name(self, obj):
        return _display_name(obj.assigned_to) if obj.assigned_to_id else None


class CategoryAssignmentSerializer(serializers.Serializer):
    """Plain (non-ModelSerializer) shape: the view builds one row per
    TicketCategory value, including categories with no CategoryAssignment
    row yet (assignee_id null) - not a 1:1 reflection of the model."""

    category = serializers.ChoiceField(choices=TicketCategory.choices)
    assignee_id = serializers.CharField(allow_null=True)
    assignee_name = serializers.CharField(allow_null=True)
