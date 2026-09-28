"""OrgChange serializers in the employee read shape: snake_case, string ids,
`{success, data}` envelope via the view's FrontendEnvelopeMixin."""

from rest_framework import serializers

from employees.models import (
    BusinessUnit,
    Department,
    Designation,
    Employee,
    Grade,
    Level,
    Location,
    Position,
)
from employees.serializers import EmployeeWriteSerializer
from orgchanges.models import OrgChange


class OrgChangeSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    changed_by_id = serializers.SerializerMethodField()

    class Meta:
        model = OrgChange
        fields = [
            "id",
            "employee_id",
            "change_type",
            "from_data",
            "to_data",
            "effective_date",
            "status",
            "changed_by_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_id(self, obj):
        return str(obj.pk)

    def get_employee_id(self, obj):
        return str(obj.employee_id)

    def get_changed_by_id(self, obj):
        return str(obj.changed_by_id) if obj.changed_by_id else None


# to_data keys each change type understands: payload key -> (Employee field,
# related model for the id lookup). Keys absent from the payload are skipped,
# so a promotion may carry any subset of designation/level/grade.
APPLIABLE_FIELDS = {
    OrgChange.TYPE_PROMOTION: {
        "designation_id": ("designation", Designation),
        "level_id": ("level", Level),
        "grade_id": ("grade", Grade),
    },
    OrgChange.TYPE_DEPT_TRANSFER: {
        "department_id": ("department", Department),
        "business_unit_id": ("business_unit", BusinessUnit),
    },
    OrgChange.TYPE_LOCATION_TRANSFER: {
        "location_id": ("location", Location),
    },
    OrgChange.TYPE_POSITION_CHANGE: {
        "position_id": ("position", Position),
    },
    OrgChange.TYPE_MANAGER_CHANGE: {
        "manager_id": ("manager", Employee),
    },
}


def validate_to_data(change_type, to_data):
    """Every id in the payload must point at a real row, and a manager change
    must not build a reporting cycle. Raises ValidationError otherwise."""
    if not isinstance(to_data, dict) or not to_data:
        raise serializers.ValidationError(
            {"to_data": 'Tell us what changes (e.g. {"department_id": "3"}).'}
        )
    fields = APPLIABLE_FIELDS.get(change_type, {})
    unknown = sorted(set(to_data) - set(fields))
    if unknown:
        raise serializers.ValidationError(
            {"to_data": f"Unknown for a {change_type}: {', '.join(unknown)}."}
        )
    resolved = {}
    for key, (field, model) in fields.items():
        if key not in to_data or to_data[key] in (None, ""):
            continue
        try:
            resolved[field] = model.objects.get(pk=to_data[key])
        except (model.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError(
                {f"to_data.{key}": f"No such {model.__name__.lower()}: {to_data[key]}."}
            )
    return resolved


class OrgChangeWriteSerializer(serializers.Serializer):
    """Input for raising (POST) and editing (PATCH) a pending change. Only
    pending rows can be edited; effective/cancelled rows are history."""

    employee_id = serializers.PrimaryKeyRelatedField(
        source="employee", queryset=Employee.objects.all()
    )
    change_type = serializers.ChoiceField(choices=OrgChange.TYPE_CHOICES)
    from_data = serializers.DictField(required=False, default=dict)
    to_data = serializers.DictField(required=False)
    effective_date = serializers.DateField()
    status = serializers.ChoiceField(choices=OrgChange.STATUS_CHOICES, required=False)

    def validate_status(self, value):
        if self.instance is not None and value == OrgChange.STATUS_EFFECTIVE:
            raise serializers.ValidationError(
                "Changes become effective through the apply_due_org_changes command, "
                "not by editing — cancel this one and raise a fresh change if needed."
            )
        if self.instance is None and value == OrgChange.STATUS_EFFECTIVE:
            raise serializers.ValidationError(
                "A change starts as pending; it becomes effective on its effective date."
            )
        return value

    def validate(self, attrs):
        change_type = attrs.get("change_type", getattr(self.instance, "change_type", None))
        to_data = attrs.get("to_data", getattr(self.instance, "to_data", None))
        if to_data is not None and change_type is not None:
            attrs["_resolved"] = validate_to_data(change_type, to_data)
        if change_type == OrgChange.TYPE_MANAGER_CHANGE and "manager" in attrs.get("_resolved", {}):
            employee = attrs.get("employee", getattr(self.instance, "employee", None))
            EmployeeWriteSerializer._reject_reporting_cycle(employee, attrs["_resolved"]["manager"])
        return attrs

    def create(self, validated):
        validated.pop("_resolved", None)
        return OrgChange.objects.create(**validated)

    def update(self, instance, validated):
        validated.pop("_resolved", None)
        for field in (
            "employee",
            "change_type",
            "from_data",
            "to_data",
            "effective_date",
            "status",
        ):
            if field in validated:
                setattr(instance, field, validated[field])
        instance.save()
        return instance
