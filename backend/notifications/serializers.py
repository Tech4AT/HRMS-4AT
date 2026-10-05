from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    # The frontend (frontend/src/lib/api/notifications.ts) reads userId and a
    # single-org organizationId; the camelCase renderer converts the snake_case
    # field names below.
    user_id = serializers.CharField(source="user.id", read_only=True)
    organization_id = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "organization_id",
            "user_id",
            "type",
            "title",
            "body",
            "read_at",
            "created_at",
        ]

    def get_organization_id(self, obj) -> str:
        entity = getattr(getattr(obj.user, "employee", None), "legal_entity_id", None)
        return str(entity) if entity else ""
