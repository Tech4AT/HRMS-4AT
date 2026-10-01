from django.db.models import Q
from rest_framework import serializers

from core.enums import EmployeeStatus
from employees.models import Department, Employee
from org_calendar.models import (
    Calendar,
    CalendarEntry,
    CalendarEntryType,
    RecurringWfhRule,
    WeekOff,
)

# `lib/api/calendar.ts` types every `id` as `string`; this app's pks are plain
# BigAutoField integers, so every id (including foreign ids) is rendered as a
# string. Each serializer declares `id` directly rather than via a shared mixin:
# DRF's SerializerMetaclass only collects declared fields from base classes that
# went through the same metaclass, so a plain mixin silently falls back to the
# model's integer field (found the hard way, caught only by checking a live
# response).


def _stringify(data: dict, *keys: str) -> dict:
    for key in keys:
        value = data.get(key)
        if isinstance(value, list):
            data[key] = [str(v) for v in value]
        elif value is not None:
            data[key] = str(value)
    return data


def covered_employees(calendar: Calendar):
    """Employees who follow `calendar`: listed on it, or in a listed department."""
    return (
        Employee.objects.filter(Q(calendars=calendar) | Q(department__calendars=calendar))
        .exclude(status=EmployeeStatus.EXITED)
        .distinct()
    )


class WeekOffRuleSerializer(serializers.Serializer):
    """One weekly off of a calendar: off every week when `weeks` is empty, else
    only on those occurrences in the month (1 = first ... 5 = fifth)."""

    weekday = serializers.IntegerField(min_value=0, max_value=6)
    weeks = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=5), required=False, default=list
    )

    def validate_weeks(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Each week may be listed only once.")
        return sorted(value)


class CalendarSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    department_ids = serializers.PrimaryKeyRelatedField(
        source="departments", many=True, queryset=Department.objects.all(), required=False
    )
    employee_ids = serializers.PrimaryKeyRelatedField(
        source="employees", many=True, queryset=Employee.objects.all(), required=False
    )
    week_offs = WeekOffRuleSerializer(many=True, required=False)
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Calendar
        fields = [
            "id",
            "name",
            "description",
            "department_ids",
            "employee_ids",
            "week_offs",
            "employee_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "employee_count", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def get_employee_count(self, obj) -> int:
        return covered_employees(obj).count()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Calendar name is required.")
        clash = Calendar.objects.filter(name__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A calendar with this name already exists.")
        return value

    def validate_week_offs(self, value):
        weekdays = [rule["weekday"] for rule in value]
        if len(set(weekdays)) != len(weekdays):
            raise serializers.ValidationError("Each weekday may be listed only once.")
        return value

    def _save_week_offs(self, calendar, week_offs):
        calendar.week_offs.all().delete()
        WeekOff.objects.bulk_create(
            WeekOff(calendar=calendar, weekday=r["weekday"], weeks=r.get("weeks", []))
            for r in week_offs
        )

    def create(self, validated_data):
        departments = validated_data.pop("departments", [])
        employees = validated_data.pop("employees", [])
        week_offs = validated_data.pop("week_offs", [])
        calendar = Calendar.objects.create(**validated_data)
        calendar.departments.set(departments)
        calendar.employees.set(employees)
        self._save_week_offs(calendar, week_offs)
        return calendar

    def update(self, instance, validated_data):
        departments = validated_data.pop("departments", None)
        employees = validated_data.pop("employees", None)
        week_offs = validated_data.pop("week_offs", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if departments is not None:
            instance.departments.set(departments)
        if employees is not None:
            instance.employees.set(employees)
        if week_offs is not None:
            self._save_week_offs(instance, week_offs)
        return instance

    def to_representation(self, instance):
        return _stringify(super().to_representation(instance), "department_ids", "employee_ids")


class CalendarEntrySerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    calendar_id = serializers.PrimaryKeyRelatedField(
        source="calendar", queryset=Calendar.objects.all()
    )

    class Meta:
        model = CalendarEntry
        fields = [
            "id",
            "calendar_id",
            "type",
            "date",
            "name",
            "description",
            "optional",
            "special",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def validate(self, attrs):
        current = self.instance
        entry_type = attrs.get("type", current.type if current else None)
        for flag in ("optional", "special"):
            if attrs.get(flag) and entry_type != CalendarEntryType.HOLIDAY:
                raise serializers.ValidationError(
                    {flag: "Only holidays can be marked optional or special."}
                )
        calendar = attrs.get("calendar", current.calendar if current else None)
        date = attrs.get("date", current.date if current else None)
        name = attrs.get("name", current.name if current else "")
        clash = CalendarEntry.objects.filter(
            calendar=calendar, type=entry_type, date=date, name__iexact=name.strip()
        )
        if current is not None:
            clash = clash.exclude(pk=current.pk)
        if clash.exists():
            raise serializers.ValidationError(
                "This calendar already has the same entry on that date."
            )
        return attrs

    def to_representation(self, instance):
        return _stringify(super().to_representation(instance), "calendar_id")


class RecurringWfhRuleSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    calendar_id = serializers.PrimaryKeyRelatedField(
        source="calendar", queryset=Calendar.objects.all()
    )

    class Meta:
        model = RecurringWfhRule
        fields = ["id", "calendar_id", "weekday", "label", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)

    def validate(self, attrs):
        current = self.instance
        calendar = attrs.get("calendar", current.calendar if current else None)
        weekday = attrs.get("weekday", current.weekday if current else None)
        clash = RecurringWfhRule.objects.filter(calendar=calendar, weekday=weekday)
        if current is not None:
            clash = clash.exclude(pk=current.pk)
        if clash.exists():
            raise serializers.ValidationError(
                "This calendar already has a recurring WFH rule for that weekday."
            )
        return attrs

    def to_representation(self, instance):
        return _stringify(super().to_representation(instance), "calendar_id")
