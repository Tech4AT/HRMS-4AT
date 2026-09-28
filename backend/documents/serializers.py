from django.utils import timezone
from rest_framework import serializers

from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    """Never serializes `file.url` (the raw MEDIA_URL storage path) — every
    consumer gets `viewUrl`/`downloadUrl` pointing at the protected
    `DocumentFileView` instead, so a permission check and an access-log
    entry sit in front of the bytes every time, not just when the metadata
    is listed. `url` is kept as an alias of `viewUrl` for callers that
    predate the view/download split."""

    url = serializers.SerializerMethodField()
    view_url = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()
    is_expired = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id', 'entity_type', 'entity_id', 'employee_id', 'original_filename',
            'url', 'view_url', 'download_url', 'uploaded_at', 'expiry_date', 'is_expired',
            'file_size', 'uploaded_by_name',
        ]

    def _file_endpoint(self, obj, mode: str | None = None):
        """Relative to the *frontend's* own origin, not this Django server —
        the browser only ever holds auth for the Next.js proxy (see
        lib/api/proxy.ts), never a direct session with the Django backend,
        so an absolute backend URL here would 401 the moment the browser
        tried to load it. `/api/documents/{id}/file` is a frontend route
        that forwards to this same Django endpoint carrying the JWT."""
        if not obj.file:
            return None
        return f'/api/documents/{obj.id}/file' + (f'?mode={mode}' if mode else '')

    def get_url(self, obj):
        return self._file_endpoint(obj)

    def get_view_url(self, obj):
        return self._file_endpoint(obj)

    def get_download_url(self, obj):
        return self._file_endpoint(obj, mode='download')

    def get_is_expired(self, obj):
        return bool(obj.expiry_date and obj.expiry_date < timezone.localdate())

    def get_file_size(self, obj):
        try:
            return obj.file.size
        except (ValueError, OSError):
            return None

    def get_uploaded_by_name(self, obj):
        if not obj.uploaded_by:
            return None
        name = f'{obj.uploaded_by.first_name} {obj.uploaded_by.last_name}'.strip()
        return name or obj.uploaded_by.email
