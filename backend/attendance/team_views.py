"""PLAN.md Step 9 — the Dashboard's real, scoped read shape. Resolves the
caller's manageable roster the same way the rest of the app already does
(`core.scope.resolve_employee_scope` — Step 9 explicitly says not to reinvent
this), unioning `attendance.approve` and `leave.approve`: either one is
already what makes the Dashboard tab nav-reachable at all (no new permission
code invented for "can see the dashboard"), and a caller could hold only one
of the two (e.g. a custom role).

Reuses `day_view.build_day_view()` directly, per employee per date — the same
function the self-service day-view already returns from `/attendance` — so a
team member's day here is computed identically to how they'd see it
themselves, not a second, parallel notion of "what does a day look like."

Two endpoints share that one rule and one row builder:

- `/attendance/team/daily` — the Dashboard: everyone in the caller's manageable
  scope. Unchanged.
- `/attendance/team/summary` — My Team: one group (direct reports, indirect
  reports or peers) of the caller. Who is *in* the group is organisation
  structure (`employees.team`); how much the caller may *see* about each person
  is the same manageable-scope rule as the Dashboard: people inside it get the
  full day view, everyone else in the group gets only whether they are in
  today. Leave, lateness, work-from-home and history never reach a caller who
  could not already read them."""

import calendar
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.enums import EmployeeStatus
from core.scope import resolve_employee_scope, user_has_permission
from employees.models import Employee
from employees.team import GROUPS, team_group

from .day_facts import get_day_facts, get_day_facts_range
from .day_view import build_day_view
from .models import AttendanceRecord
from .serializers import _display_name
from .timing import shift_for
from .views import _resolve_window

# Who may read a person's day in full: whoever can approve their attendance or
# leave. Shared by both endpoints below so they can never disagree.
_DETAIL_PERMISSIONS = ("attendance.approve", "leave.approve")


def can_view_team_attendance(user) -> bool:
    return any(user_has_permission(user, code) for code in _DETAIL_PERMISSIONS)


def manageable_employee_ids(user) -> set:
    """Ids of everyone whose full attendance day the caller may read: the union
    of the `attendance.approve` and `leave.approve` scopes."""
    ids = set()
    for code in _DETAIL_PERMISSIONS:
        ids |= set(resolve_employee_scope(user, code).values_list("pk", flat=True))
    return ids


def build_day_rows(employees, start_date, end_date, today) -> list:
    """One row per (employee, date): the self-service day view plus who it is.
    The single place a team member's day is computed for a multi-employee read."""
    rows = []
    for employee in employees:
        facts_by_day = get_day_facts_range(start_date, end_date, employee=employee)
        shift = shift_for(employee)
        records = {
            r.attendance_date: r
            for r in AttendanceRecord.objects.filter(
                employee=employee, attendance_date__range=(start_date, end_date)
            ).prefetch_related("breaks")
        }
        day = start_date
        while day <= end_date:
            view = build_day_view(
                day, records.get(day), today=today, facts=facts_by_day[day], shift=shift
            )
            rows.append(
                {
                    "employee_id": str(employee.pk),
                    "employee_name": _display_name(employee),
                    "department": employee.department.name if employee.department_id else None,
                    **view,
                }
            )
            day += timedelta(days=1)
    return rows


class TeamDailyAttendanceView(APIView):
    """`/attendance/team/daily?month=YYYY-MM` or `?from=&to=` — one row per
    (employee in the caller's scope, date in the window), for the Dashboard.
    Plain snake_case JSON (`FrontendEnvelopeMixin`'s renderer/parser, applied
    directly since this is an APIView, not a ViewSet) so the frontend can
    reuse the exact same `AttendanceDayView`-shaped parsing it already has for
    the self-service day-view, not a second, camelCase-flavoured contract."""

    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_view_team_attendance(request.user):
            raise PermissionDenied("You don't have access to team attendance data.")

        start_date, end_date = _resolve_window(request)

        employees = (
            Employee.objects.filter(
                pk__in=manageable_employee_ids(request.user), status=EmployeeStatus.ACTIVE
            )
            .select_related("user", "department")
            .order_by("employee_code")
        )

        rows = build_day_rows(employees, start_date, end_date, timezone.localdate())
        return Response({"success": True, "data": rows})


MAX_MEMBER_WINDOW_DAYS = 31


class TeamMemberAttendanceView(APIView):
    """`/attendance/team/member/<employee id>?month=YYYY-MM` or `?from=&to=` —
    one person's day-by-day attendance (check-in/out, hours, late/early/overtime,
    every break) for a manager or HR looking into someone, at most 31 days.

    Only for people the caller may read in full (the same manageable-scope rule
    as the Dashboard and My Team): anyone else, including a peer who could see
    this person's presence, gets 403 and no data."""

    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not can_view_team_attendance(request.user):
            raise PermissionDenied("You don't have access to team attendance data.")
        employee = Employee.objects.select_related("user", "department").filter(pk=pk).first()
        if employee is None:
            raise NotFound("No such employee.")
        if employee.pk not in manageable_employee_ids(request.user):
            raise PermissionDenied("You may not view this person's attendance.")

        start_date, end_date = _resolve_window(request)
        if end_date < start_date:
            raise ValidationError({"to": "Must not be before the start date."})
        if (end_date - start_date).days + 1 > MAX_MEMBER_WINDOW_DAYS:
            raise ValidationError(
                {"to": f"At most {MAX_MEMBER_WINDOW_DAYS} days can be viewed at once."}
            )

        rows = build_day_rows([employee], start_date, end_date, timezone.localdate())
        return Response(
            {
                "success": True,
                "data": {
                    "employee_id": str(employee.pk),
                    "employee_name": _display_name(employee),
                    "department": employee.department.name if employee.department_id else None,
                    "rows": rows,
                },
            }
        )


# What the caller learns about someone they may not read in full.
PRESENCE_IN = "in"
PRESENCE_NOT_IN = "not_in"
PRESENCE_DAY_OFF = "day_off"

_CHECKED_IN_STATUSES = {"present", "work_from_home", "half_day"}


def presence_of(day_view: dict) -> str:
    """Collapse a day view to the only thing a peer may learn: a day off (an
    organisation-wide fact, not about the person), in, or not in. "Not in" is
    deliberately blunt: leave, absence and not-yet-clocked-in are
    indistinguishable, so nothing about *why* leaks."""
    status = day_view["status"]
    if status in ("holiday", "weekend"):
        return PRESENCE_DAY_OFF
    return PRESENCE_IN if status in _CHECKED_IN_STATUSES else PRESENCE_NOT_IN


def _month_window(request, today: date):
    if request.query_params.get("month"):
        return _resolve_window(request)
    return date(today.year, today.month, 1), date(
        today.year, today.month, calendar.monthrange(today.year, today.month)[1]
    )


class TeamSummaryView(APIView):
    """`/attendance/team/summary?group=direct|indirect|peers[&month=YYYY-MM]` —
    the My Team page's one read, for the caller's own team.

    Response `data`:
    - `members`: every person in the group, each with `level` (`detail` when the
      caller may read their full day, otherwise `basic`) and today's `presence`.
    - `rows`: the full day views (same shape as `/attendance/team/daily`) for
      `detail` members only: the requested month, plus today.
    - `coverage`: `{total, detail}` so the UI can say "based on 3 of 10 people"
      instead of implying the numbers describe everyone.
    Only the requested group is ever loaded, and the per-day work runs only for
    `detail` members."""

    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = getattr(request.user, "employee", None)
        if me is None:
            raise PermissionDenied("This account has no employee record.")

        group = request.query_params.get("group")
        if group not in GROUPS:
            raise ValidationError({"group": f"Must be one of: {', '.join(GROUPS)}."})

        today = timezone.localdate()
        start_date, end_date = _month_window(request, today)

        members = list(
            team_group(me, group).select_related("user", "department").order_by("employee_code")
        )
        detail_ids = manageable_employee_ids(request.user) if can_view_team_attendance(
            request.user
        ) else set()
        detail_members = [m for m in members if m.pk in detail_ids]
        basic_members = [m for m in members if m.pk not in detail_ids]

        rows = build_day_rows(detail_members, start_date, end_date, today)
        if not start_date <= today <= end_date:
            rows += build_day_rows(detail_members, today, today, today)

        presence = {}
        today_key = today.isoformat()
        for row in rows:
            if row["attendance_date"] == today_key:
                presence[row["employee_id"]] = presence_of(row)

        if basic_members:
            # Organisation-wide facts (holiday / week off) plus today's clock-ins:
            # nothing per-person about leave, so it cannot leak.
            facts = get_day_facts(today)
            records = {
                r.employee_id: r
                for r in AttendanceRecord.objects.filter(
                    employee__in=basic_members, attendance_date=today
                ).prefetch_related("breaks")
            }
            for member in basic_members:
                view = build_day_view(
                    today, records.get(member.pk), today=today, facts=facts, shift=None
                )
                presence[str(member.pk)] = presence_of(view)

        detail_pks = {m.pk for m in detail_members}
        return Response(
            {
                "success": True,
                "data": {
                    "group": group,
                    "date": today_key,
                    "month": f"{start_date.year}-{start_date.month:02d}",
                    "has_manager": me.manager_id is not None,
                    "coverage": {"total": len(members), "detail": len(detail_members)},
                    "members": [
                        {
                            "employee_id": str(m.pk),
                            "level": "detail" if m.pk in detail_pks else "basic",
                            "presence": presence[str(m.pk)],
                        }
                        for m in members
                    ],
                    "rows": rows,
                },
            }
        )
