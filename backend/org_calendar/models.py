"""Org-wide calendar: holidays, special events, and WFH days (one-off dates or
a recurring weekday rule). HR-admin-managed (calendar.manage); every
employee's attendance view reads the same data, so a change here applies
organisation-wide. Not employee-keyed - there is no `employee` FK here, so
these are gated by the flat HasPermissionCode check (see views.py), not
ScopedEmployeePermission.

Matches frontend/src/lib/api/calendar.ts's CalendarEntry/RecurringWfhRule
contract field-for-field."""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

# Matches WEEKDAY_NAMES in lib/api/calendar.ts - Sunday-first, not Python's
# Monday-first date.weekday(). This is just a label lookup for the default
# recurring-rule name; the stored `weekday` integer is never compared against
# Python's own weekday() anywhere in this module.
WEEKDAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)


class CalendarEntryType(models.TextChoices):
    HOLIDAY = "holiday", "Holiday"
    WFH = "wfh", "WFH"
    EVENT = "event", "Event"


class CalendarEntry(models.Model):
    type = models.CharField(max_length=20, choices=CalendarEntryType.choices)
    date = models.DateField()
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True, default=None)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "id"]

    def __str__(self):
        return f"{self.get_type_display()}: {self.name} ({self.date})"


class WeekOff(models.Model):
    """Which weekdays are org-wide non-working days — HR-admin-configurable
    rather than a hardcoded Saturday/Sunday assumption, since not every
    organisation's week-off pattern is the same. One row per weekday that's
    ever been configured; `active` toggles it without losing the row (same
    shape as RecurringWfhRule, for the same reason). A weekday with no row at
    all is treated as a working day — see attendance/day_facts.py's consumer
    side, which is the reason this model exists.

    Deliberately simple: a single, org-wide, non-alternating weekly pattern.
    A shift-based or team-specific week-off (e.g. alternate Saturdays) is out
    of scope here — PLAN.md Step 6 (Shifts) is where a per-employee working
    pattern would live, if one is ever needed."""

    weekday = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        unique=True,
        help_text="0 = Sunday ... 6 = Saturday, matching WEEKDAY_NAMES.",
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["weekday"]

    def __str__(self):
        return f"{WEEKDAY_NAMES[self.weekday]} ({'off' if self.active else 'working'})"


class RecurringWfhRule(models.Model):
    """A weekday-wide WFH rule, e.g. "every Wednesday". Independent of any
    one-off CalendarEntry(type=wfh) - both are checked when deciding whether
    a given date is a WFH day."""

    weekday = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        help_text="0 = Sunday ... 6 = Saturday, matching WEEKDAY_NAMES.",
    )
    # Blank allowed at the model/serializer level - the view fills in a
    # default ("Every <Weekday>") when none is given, matching the frontend's
    # optional `label` on create.
    label = models.CharField(max_length=200, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["weekday", "id"]

    def save(self, *args, **kwargs):
        if not self.label:
            self.label = f"Every {WEEKDAY_NAMES[self.weekday]}"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.label
