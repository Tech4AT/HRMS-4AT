"""Builds the frontend's AttendanceDayView shape (lib/api/attendance.ts) for
one date. The independent overlay booleans/fields (is_weekend, is_holiday,
holiday_name, on_leave, is_wfh_day, events, ...) always reflect day_facts.py
honestly — nothing here hides a simultaneous fact to make room for the single
`status` field.

`status` itself still has to be exactly one of AttendanceDayStatus's values
(a fixed, existing frontend contract — MyAttendanceCalendar's toAttendanceRow
switches on it directly, see PLAN.md Step 3), so a choice is unavoidable when
more than one thing is true. Precedence, narrowest-fact-wins removed, broadest
org-wide fact first: **Holiday > Weekend/week-off > Leave > a clock-in-derived
status > absent/not_marked**. This is not an arbitrary tie-break — it's the
direct, consistent extension of two decisions already made elsewhere:

- Leave is explicitly *allowed* to span a Holiday or week-off (leave/conflicts.py
  doesn't reject it), and leave/models.py's duration calculation *excludes*
  Holiday/week-off days from what a leave request actually consumes — a day
  that isn't being drawn from the balance shouldn't display as "On Leave"
  either, so Holiday/Weekend outrank Leave here for the same reason they
  already outrank a clock-in.
- Holiday/Weekend already outranked a voluntary clock-in before Leave existed
  (an org-wide non-working fact wins over what one person happened to do that
  day); Leave — an approved, per-employee fact — sits in exactly the same
  relationship to a clock-in, for the same reason, one level down.

None of this hides anything: `check_in`/`check_out`/`working_minutes` and
`on_leave`/`leave_type_name` are always populated from their own fields below
regardless of what `status` says — the granular facts are the source of truth
(day_facts.py); `status` is a single best-effort label for callers that only
read one field."""

from attendance.day_facts import get_day_facts


def _events_payload(facts):
    return [{"name": e.name, "description": e.description} for e in facts.events]


def build_day_view(the_date, record, *, today, employee=None, facts=None) -> dict:
    """`facts` lets a multi-day caller pass an already-computed DayFacts (from
    day_facts.get_day_facts_range(), fetched once for the whole range) instead
    of this function fetching it per date — pass `employee` alone for a single
    date and it's fetched here."""
    if facts is None:
        facts = get_day_facts(the_date, employee=employee)

    if facts.is_holiday:
        status = "holiday"
    elif facts.is_weekend:
        status = "weekend"
    elif facts.is_on_leave:
        status = "on_leave"
    elif record is not None:
        status = record.status
    elif the_date < today:
        status = "absent"
    else:
        status = "not_marked"

    breaks = list(record.breaks.all()) if record is not None else []
    on_break = any(b.end_time is None for b in breaks)
    break_minutes = sum(b.minutes for b in breaks)

    return {
        "attendance_date": the_date.isoformat(),
        "status": status,
        "check_in": record.clock_in_time.isoformat() if record and record.clock_in_time else None,
        "check_out": (
            record.clock_out_time.isoformat() if record and record.clock_out_time else None
        ),
        "working_minutes": record.working_minutes if record else None,
        "late_minutes": record.late_minutes if record else None,
        "early_leave_minutes": record.early_leave_minutes if record else None,
        "overtime_minutes": record.overtime_minutes if record else None,
        "is_weekend": facts.is_weekend,
        "is_holiday": facts.is_holiday,
        "holiday_name": facts.holiday_name,
        "holiday_description": facts.holiday_description,
        "on_leave": facts.is_on_leave,
        "leave_type_name": facts.leave_type_name,
        "source": record.source if record else None,
        "notes": record.notes if record else None,
        "record_id": str(record.pk) if record else None,
        "on_break": on_break,
        "break_minutes": break_minutes,
        "is_wfh_day": facts.is_org_wfh_day,
        "wfh_note": facts.org_wfh_note,
        "wfh_description": facts.org_wfh_description,
        "events": _events_payload(facts),
    }
