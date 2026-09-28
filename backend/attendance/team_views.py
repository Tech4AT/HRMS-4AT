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
themselves, not a second, parallel notion of "what does a day look like."""

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.enums import EmployeeStatus
from core.scope import resolve_employee_scope, user_has_permission
from employees.models import Employee

from .day_facts import get_day_facts_range
from .day_view import build_day_view
from .models import AttendanceRecord
from .serializers import _display_name
from .timing import shift_for
from .views import _resolve_window


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
        if not (
            user_has_permission(request.user, "attendance.approve")
            or user_has_permission(request.user, "leave.approve")
        ):
            raise PermissionDenied("You don't have access to team attendance data.")

        start_date, end_date = _resolve_window(request)

        scoped_ids = set(
            resolve_employee_scope(request.user, "attendance.approve").values_list("pk", flat=True)
        )
        scoped_ids |= set(
            resolve_employee_scope(request.user, "leave.approve").values_list("pk", flat=True)
        )
        employees = (
            Employee.objects.filter(pk__in=scoped_ids, status=EmployeeStatus.ACTIVE)
            .select_related("user", "department")
            .order_by("employee_code")
        )

        today = timezone.localdate()
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

        return Response({"success": True, "data": rows})
