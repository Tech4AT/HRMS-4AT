from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('original_filename', 'entity_type', 'entity_id', 'employee', 'uploaded_by', 'uploaded_at')
    list_filter = ('entity_type',)
