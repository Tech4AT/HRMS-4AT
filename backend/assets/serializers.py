from rest_framework import serializers

from assets.models import Asset


class AssetSerializer(serializers.ModelSerializer):
    status = serializers.ReadOnlyField()
    assigned_to_name = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = [
            "id",
            "asset_tag",
            "category",
            "brand",
            "serial",
            "processor",
            "ram",
            "date_of_allotment",
            "date_of_recover",
            "has_bag",
            "previously_used",
            "assigned_to",
            "assigned_to_name",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "assigned_to_name", "created_at", "updated_at"]

    def get_assigned_to_name(self, obj):
        user = getattr(getattr(obj, "assigned_to", None), "user", None)
        return user.get_full_name().strip() if user is not None else ""
