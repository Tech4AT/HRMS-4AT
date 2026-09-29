from django.apps import AppConfig


class LeaveConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "leave"

    def ready(self):
        # Register the request_decided receiver (see handlers.py) — only
        # relevant for requires_approval=True requests; an auto-approved
        # LeaveType never raises a Request, so never reaches this receiver.
        from . import handlers  # noqa: F401
