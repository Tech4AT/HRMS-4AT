from django.apps import AppConfig


class AttendanceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "attendance"

    def ready(self):
        # Register the request_decided receiver (see handlers.py) — the
        # approvals engine's consumer-side contract (docs/LEAVE-ATTENDANCE-
        # INTEGRATION.md, example_leave/apps.py).
        from . import handlers  # noqa: F401
