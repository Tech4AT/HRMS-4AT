from rest_framework import serializers

from audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default=None)
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "created_at",
            "action",
            "entity_type",
            "entity_id",
            "actor",
            "actor_email",
            "actor_name",
            "diff",
        ]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.email


def display_name(employee):
    """A human label for an employee row — never blank, never invented."""
    if employee is None:
        return None
    name = (employee.full_name or "").strip()
    if name:
        return name
    user = getattr(employee, "user", None)
    if user is not None:
        name = (user.get_full_name() or "").strip()
        if name:
            return name
        if getattr(user, "email", ""):
            return user.email
    return employee.employee_code


class EmployeeActivitySerializer(serializers.ModelSerializer):
    """One audit row framed around the employee it concerns (same camelCase
    + paginated convention as the system audit-log view)."""

    occurred_at = serializers.DateTimeField(source="created_at", read_only=True)
    category = serializers.SerializerMethodField()
    employee = serializers.SerializerMethodField()
    actor = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "occurred_at",
            "action",
            "category",
            "employee",
            "actor",
            "summary",
            "entity_type",
            "entity_id",
        ]

    def get_category(self, obj):
        from audit.views import action_category

        return action_category(obj.action)

    def get_employee(self, obj):
        from audit.views import resolve_subject

        employee = resolve_subject(obj, cache=self.context.get("employee_cache"))
        if employee is None:
            return None
        return {"id": employee.pk, "code": employee.employee_code, "name": display_name(employee)}

    def get_actor(self, obj):
        actor = obj.actor
        if actor is None:
            return None
        employee = getattr(actor, "employee", None)
        return {
            "id": actor.pk,
            "email": actor.email,
            "name": actor.get_full_name() or actor.email,
            "employee_id": getattr(employee, "pk", None),
        }

    def get_summary(self, obj):
        from audit.views import resolve_subject, summarize

        return summarize(
            obj,
            employee_name=display_name(
                resolve_subject(obj, cache=self.context.get("employee_cache"))
            ),
        )
