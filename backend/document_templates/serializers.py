from rest_framework import serializers

from document_templates.models import DocumentTemplate, TemplateFolder


class TemplateFolderSerializer(serializers.ModelSerializer):
    template_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = TemplateFolder
        fields = ["id", "name", "ordering", "template_count"]
        read_only_fields = ["id", "template_count"]


class DocumentTemplateSerializer(serializers.ModelSerializer):
    folder_name = serializers.CharField(source="folder.name", read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentTemplate
        fields = [
            "id",
            "name",
            "folder",
            "folder_name",
            "action_type",
            "workflow_enabled",
            "body",
            "file",
            "last_used_at",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "folder_name",
            "last_used_at",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]

    def get_created_by_name(self, obj):
        user = getattr(obj, "created_by", None)
        if user is None:
            return None
        name = user.get_full_name().strip()
        return name or user.email

    # NOTE: no manual camelCase aliases — the global CamelCaseJSONRenderer
    # (base.py DRF settings) converts every snake_case key automatically.
