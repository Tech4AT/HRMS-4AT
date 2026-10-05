"""Calendars: holidays, special events, WFH days and weekly offs, each owned by
one `Calendar`. Calendars are independent peers - there is no default or
fallback calendar and no hierarchy between them. A calendar applies to the
departments and/or individual employees listed on it, and an employee can be
covered by any number of calendars; attendance/day_facts.py combines them
additively (see org_calendar/resolution.py for the exact rules).

HR-admin-managed (calendar.manage). Not employee-keyed data, so these views use
the flat HasPermissionCode check (see views.py), not ScopedEmployeePermission."""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

# Sunday-first, matching lib/api/calendar.ts - not Python's Monday-first
# date.weekday(). A label lookup for the default recurring-rule name; the stored
# `weekday` integer is converted at one point only (resolution.sunday_first).
WEEKDAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)


class Calendar(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=300, blank=True)
    departments = models.ManyToManyField(
        "employees.Department", related_name="calendars", blank=True
    )
    employees = models.ManyToManyField("employees.Employee", related_name="calendars", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CalendarEntryType(models.TextChoices):
    HOLIDAY = "holiday", "Holiday"
    WFH = "wfh", "WFH"
    EVENT = "event", "Event"


class CalendarEntry(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name="entries")
    type = models.CharField(max_length=20, choices=CalendarEntryType.choices)
    date = models.DateField()
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True, default=None)
    # Holiday flags (ignored for events/WFH). An optional holiday is one an
    # employee may choose to take; it does not close the day. Special marks
    # holidays that are called out (e.g. company-declared).
    optional = models.BooleanField(default=False)
    special = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "id"]

    def __str__(self):
        return f"{self.get_type_display()}: {self.name} ({self.date})"


class WeekOff(models.Model):
    """A weekly off of one calendar: `weekday` is off every week when `weeks` is
    empty, otherwise only on the listed occurrences within the month (1 = first
    ... 5 = fifth), e.g. weekday=6, weeks=[2, 4] is the 2nd and 4th Saturday.
    The row existing means the day is off; delete it to make it a working day. A
    weekday with no row is a working day for that calendar."""

    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name="week_offs")
    weekday = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        help_text="0 = Sunday ... 6 = Saturday, matching WEEKDAY_NAMES.",
    )
    weeks = models.JSONField(
        default=list,
        blank=True,
        help_text="Occurrences in the month that are off (1-5). Empty = every week.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["weekday"]
        constraints = [
            models.UniqueConstraint(fields=["calendar", "weekday"], name="uniq_weekoff_per_day")
        ]

    def __str__(self):
        return f"{WEEKDAY_NAMES[self.weekday]} ({self.calendar_id})"


class RecurringWfhRule(models.Model):
    """A weekday-wide WFH rule of one calendar, e.g. "every Wednesday".
    Independent of any one-off CalendarEntry(type=wfh) - both are checked when
    deciding whether a given date is a WFH day."""

    calendar = models.ForeignKey(
        Calendar, on_delete=models.CASCADE, related_name="recurring_wfh_rules"
    )
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
