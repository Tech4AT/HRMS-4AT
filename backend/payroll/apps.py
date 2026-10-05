from django.apps import AppConfig


class PayrollConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "payroll"

    def ready(self):
        # Connects the approvals-engine receiver (shared Approvals inbox).
        from payroll.integrations import approvals_bridge  # noqa: F401
