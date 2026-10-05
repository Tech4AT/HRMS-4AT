from django.contrib import admin

from .models import Document, DocumentAcknowledgement


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('original_filename', 'entity_type', 'entity_id', 'employee', 'audience', 'acknowledgement_required', 'uploaded_by', 'uploaded_at')
    list_filter = ('entity_type', 'audience', 'acknowledgement_required')


@admin.register(DocumentAcknowledgement)
class DocumentAcknowledgementAdmin(admin.ModelAdmin):
    list_display = ('document', 'employee', 'acknowledged_at')
    list_filter = ('acknowledged_at',)
