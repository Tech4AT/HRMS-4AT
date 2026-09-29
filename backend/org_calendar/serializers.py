from rest_framework import serializers

from org_calendar.models import CalendarEntry, RecurringWfhRule, WeekOff

# `lib/api/calendar.ts` types every `id` as `string`; this app's pks are plain
# BigAutoField integers. Found returning bare ints during a comprehensive
# post-Step-6 audit — the same class of bug already fixed in attendance/
# leave's serializers, just missed here since this module was built first,
# before that pattern was established. Fixing for consistency: nothing in the
# frontend does number-specific math on these ids (only equality against
# another value from the same API), so this is safe.
#
# A shared mixin (`id = SerializerMethodField()` declared once, reused via
# inheritance) was tried first and silently didn't work: DRF's
# SerializerMetaclass only pulls declared fields from base classes that
# themselves went through that same metaclass (have their own
# `_declared_fields`) — a plain mixin class doesn't, so `id` fell straight
# back to the model's auto-generated IntegerField with no error at all,
# caught only by checking the actual live response, not by reading the code.
# Each class below declares it directly instead, matching every other
# serializer in this codebase.


class CalendarEntrySerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()

    class Meta:
        model = CalendarEntry
        fields = ["id", "type", "date", "name", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)


class RecurringWfhRuleSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()

    class Meta:
        model = RecurringWfhRule
        fields = ["id", "weekday", "label", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)


class WeekOffSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()

    class Meta:
        model = WeekOff
        fields = ["id", "weekday", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_id(self, obj) -> str:
        return str(obj.pk)
