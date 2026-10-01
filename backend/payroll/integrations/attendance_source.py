"""Payroll's attendance source (API contract §5.2), built on the attendance,
leave and org_calendar apps.

For each payroll-eligible employee it turns the period's days into the
summary payroll needs: payable days, LOP, paid / unpaid leave, OT hours and
pending leave requests. The rules are deliberately conservative:

- Week-offs and holidays (org_calendar) are never working days.
- Approved leave counts as paid or unpaid by its LeaveType.is_paid; a
  single-day half-day request counts as 0.5.
- An `absent` record is LOP; a `half_day` record is half present, half LOP.
- A working day with no record (or `not_marked`) is NOT assumed absent: the
  summary is returned with status "pending" so payroll raises an
  ATTENDANCE_NOT_FINAL warning instead of silently cutting pay.
"""

from datetime import date, timedelta
from decimal import Decimal

from attendance.day_facts import get_day_facts_range
from attendance.models import AttendanceRecord, AttendanceStatus
from leave.models import HalfDayOption, LeaveRequest, LeaveRequestStatus

HALF = Decimal("0.5")
ONE = Decimal("1")


def _leave_weight(leave_request):
    single_day = leave_request.start_date == leave_request.end_date
    if single_day and leave_request.half_day_option != HalfDayOption.FULL_DAY:
        return HALF
    return ONE


def employee_summary(period, employee, today=None):
    today = today or date.today()
    start, end = period.start_date, period.end_date
    window_start = max(start, employee.date_of_joining or start)
    window_end = min(end, employee.date_of_exit or end)
    facts = get_day_facts_range(start, end, employee=employee)

    approved_leave = {}
    for leave_request in LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequestStatus.APPROVED,
        start_date__lte=window_end,
        end_date__gte=window_start,
    ).select_related("leave_type"):
        day = max(leave_request.start_date, window_start)
        while day <= min(leave_request.end_date, window_end):
            approved_leave.setdefault(day, leave_request)
            day += timedelta(days=1)

    records = {
        r.attendance_date: r
        for r in AttendanceRecord.objects.filter(
            employee=employee, attendance_date__range=(window_start, window_end)
        )
    }

    working_days_period = sum(1 for f in facts.values() if not f.is_weekend and not f.is_holiday)
    working_days_window = 0
    present = paid_leave = unpaid_leave = absent = Decimal(0)
    unmarked = 0
    ot_minutes = 0
    day = window_start
    while day <= window_end:
        record = records.get(day)
        if record and record.overtime_minutes:
            ot_minutes += record.overtime_minutes
        f = facts[day]
        if not f.is_weekend and not f.is_holiday:
            working_days_window += 1
            leave_request = approved_leave.get(day)
            if leave_request is not None:
                weight = _leave_weight(leave_request)
                if leave_request.leave_type.is_paid:
                    paid_leave += weight
                else:
                    unpaid_leave += weight
                present += ONE - weight
            elif record is None or record.status == AttendanceStatus.NOT_MARKED:
                unmarked += 1
            elif record.status == AttendanceStatus.ABSENT:
                absent += ONE
            elif record.status == AttendanceStatus.HALF_DAY:
                present += HALF
                absent += HALF
            else:  # present, work from home
                present += ONE
        day += timedelta(days=1)

    lop = unpaid_leave + absent
    basis = period.pay_group.proration_basis
    period_days = (end - start).days + 1
    window_days = (window_end - window_start).days + 1 if window_end >= window_start else 0
    if basis == "working_days":
        working_days, eligible = Decimal(working_days_period), Decimal(working_days_window)
    elif basis == "fixed_30":
        working_days = Decimal(30)
        eligible = (
            Decimal(30)
            if window_days == period_days
            else max(Decimal(0), Decimal(30) - (period_days - window_days))
        )
    else:
        working_days, eligible = Decimal(period_days), Decimal(window_days)
    lop = min(lop, eligible)

    pending_leave = LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequestStatus.SUBMITTED,
        start_date__lte=window_end,
        end_date__gte=window_start,
    ).count()
    is_final = unmarked == 0 and period.end_date < today
    return {
        "employee_id": employee.pk,
        "working_days": working_days,
        "payable_days": eligible - lop,
        "present_days": present,
        "lop_days": lop,
        "paid_leave_days": paid_leave,
        "unpaid_leave_days": unpaid_leave,
        "ot_hours": (Decimal(ot_minutes) / 60).quantize(Decimal("0.01")),
        "pending_leave_requests": pending_leave,
        "status": "final" if is_final else "pending",
        "unmarked_days": unmarked,
    }


def period_summary(period):
    """Called by payroll's "Sync from Attendance module" action."""
    from payroll.services.periods import population

    return [employee_summary(period, employee) for employee in population(period)]
