from django.contrib import admin

from lms_integration import models


@admin.register(models.LmsIdentityLink)
class LmsIdentityLinkAdmin(admin.ModelAdmin):
    list_display = ("employee", "learner_id", "status", "linked_at", "last_synced_at")
    list_filter = ("status",)
    search_fields = ("employee__employee_code", "learner_id")
    readonly_fields = ("created_at", "updated_at")


class DeliveryInline(admin.TabularInline):
    model = models.IntegrationDelivery
    extra = 0
    readonly_fields = (
        "attempt_no",
        "target",
        "succeeded",
        "http_status",
        "error",
        "duration_ms",
        "attempted_at",
    )
    can_delete = False


@admin.register(models.IntegrationEvent)
class IntegrationEventAdmin(admin.ModelAdmin):
    list_display = (
        "event_id",
        "event_type",
        "direction",
        "employee",
        "status",
        "attempt_count",
        "created_at",
    )
    list_filter = ("direction", "status", "event_type")
    search_fields = ("event_id", "correlation_id", "employee__employee_code")
    readonly_fields = [f.name for f in models.IntegrationEvent._meta.fields]
    inlines = [DeliveryInline]


@admin.register(models.ReconciliationRun)
class ReconciliationRunAdmin(admin.ModelAdmin):
    list_display = ("id", "trigger", "status", "provision", "started_at", "finished_at")
    readonly_fields = [f.name for f in models.ReconciliationRun._meta.fields]
