from django.apps import AppConfig


class LmsIntegrationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "lms_integration"
    verbose_name = "LMS integration"

    def ready(self):
        # Employee / onboarding lifecycle hooks that queue outbound LMS events.
        from lms_integration import signals  # noqa: F401
