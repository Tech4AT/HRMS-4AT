from django.contrib import admin

from .models import (
    BackgroundVerification,
    OfferLetter,
    OfferLetterTemplate,
    OnboardingProfile,
    OnboardingTask,
    OnboardingTaskTemplate,
    OnboardingWebhookEvent,
)


class OnboardingTaskInline(admin.TabularInline):
    model = OnboardingTask
    extra = 0
    fields = ('title', 'category', 'owner', 'status', 'due_date', 'is_required')


@admin.register(OnboardingProfile)
class OnboardingProfileAdmin(admin.ModelAdmin):
    list_display = ('employee', 'stage', 'buddy', 'day1_completed_at', 'completed_at')
    list_filter = ('stage',)
    inlines = [OnboardingTaskInline]


@admin.register(OnboardingTaskTemplate)
class OnboardingTaskTemplateAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'owner', 'offset_days', 'is_required', 'is_active', 'sort_order')
    list_filter = ('category', 'owner', 'is_active')
    ordering = ('category', 'sort_order')


@admin.register(OnboardingTask)
class OnboardingTaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'profile', 'category', 'owner', 'status', 'due_date')
    list_filter = ('category', 'status', 'owner')


@admin.register(OfferLetter)
class OfferLetterAdmin(admin.ModelAdmin):
    list_display = ('offer_number', 'version', 'is_current', 'profile', 'annual_ctc', 'currency', 'status', 'generated_at', 'sent_at')
    list_filter = ('status', 'currency', 'employment_type', 'is_current')
    readonly_fields = ('signing_token_hash',)


@admin.register(OnboardingWebhookEvent)
class OnboardingWebhookEventAdmin(admin.ModelAdmin):
    list_display = ('provider', 'event_type', 'external_event_id', 'offer', 'received_at', 'processed_at')
    list_filter = ('provider', 'event_type')


@admin.register(OfferLetterTemplate)
class OfferLetterTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_default', 'is_active', 'updated_at')
    list_filter = ('is_default', 'is_active')


@admin.register(BackgroundVerification)
class BackgroundVerificationAdmin(admin.ModelAdmin):
    list_display = ('profile', 'status', 'ready_at', 'reviewed_by', 'reviewed_at')
    list_filter = ('status',)
