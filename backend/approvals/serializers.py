from rest_framework import serializers

from .models import Request


class RequestSerializer(serializers.ModelSerializer):
    requester = serializers.CharField(source="requester_id", read_only=True)
    approver = serializers.CharField(source="approver_id", read_only=True, allow_null=True)
    decided_by = serializers.CharField(source="decided_by_id", read_only=True, allow_null=True)

    class Meta:
        model = Request
        fields = [
            "id",
            "request_type",
            "requester",
            "approver",
            "status",
            "payload",
            "decision_note",
            "decided_by",
            "decided_at",
            "created_at",
            "updated_at",
        ]
