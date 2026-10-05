from django.apps import AppConfig


class ExampleLeaveConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "example_leave"

    def ready(self):
        # Register the request_decided receiver (see handlers.py).
        from . import handlers  # noqa: F401
