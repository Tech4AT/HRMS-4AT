from rest_framework import serializers

from org_calendar.models import CalendarEntry, RecurringWfhRule


class CalendarEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarEntry
        fields = ["id", "type", "date", "name", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class RecurringWfhRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringWfhRule
        fields = ["id", "weekday", "label", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
