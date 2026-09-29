import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import AttendanceRecord
from employees.factories import EmployeeFactory
from org_calendar.models import CalendarEntry

pytestmark = pytest.mark.django_db

TODAY_URL = "/api/v1/attendance/today"
HISTORY_URL = "/api/v1/attendance"
SUMMARY_URL = "/api/v1/attendance/summary"
CHECK_IN = "/api/v1/attendance/check-in"
BREAK_START = "/api/v1/attendance/break-start"
BREAK_END = "/api/v1/attendance/break-end"


def _client():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def test_today_with_no_record_is_not_marked():
    client, _ = _client()

    response = client.get(TODAY_URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "not_marked"
    assert data["check_in"] is None
    assert data["events"] == []


def test_today_reflects_a_holiday_and_keeps_events_independent():
    client, _ = _client()
    today = timezone.localdate().isoformat()
    CalendarEntry.objects.create(type="holiday", date=today, name="Founders Day")
    CalendarEntry.objects.create(type="event", date=today, name="Town Hall")

    response = client.get(TODAY_URL)

    data = response.json()["data"]
    assert data["status"] == "holiday"
    assert data["is_holiday"] is True
    assert data["holiday_name"] == "Founders Day"
    # The event is never hidden by the holiday status winning the single field.
    assert data["events"] == [{"name": "Town Hall", "description": None}]


def test_holiday_status_does_not_hide_a_voluntary_clock_in():
    client, employee = _client()
    today = timezone.localdate().isoformat()
    CalendarEntry.objects.create(type="holiday", date=today, name="Founders Day")
    client.post(CHECK_IN, {}, format="json")

    response = client.get(TODAY_URL)

    data = response.json()["data"]
    assert data["status"] == "holiday"  # holiday wins the single field...
    assert data["check_in"] is not None  # ...but the clock-in fact isn't lost


def test_history_returns_one_row_per_day_in_range():
    client, employee = _client()
    AttendanceRecord.objects.create(
        employee=employee, attendance_date="2026-04-01", status="present"
    )

    response = client.get(HISTORY_URL, {"from": "2026-04-01", "to": "2026-04-03"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert [row["attendance_date"] for row in data] == ["2026-04-01", "2026-04-02", "2026-04-03"]
    assert data[0]["status"] == "present"


def test_history_by_month():
    client, _ = _client()

    response = client.get(HISTORY_URL, {"month": "2026-02"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 28  # 2026 is not a leap year
    assert data[0]["attendance_date"] == "2026-02-01"
    assert data[-1]["attendance_date"] == "2026-02-28"


def test_summary_counts_weekends_holidays_and_present_days():
    client, employee = _client()
    # 2026-04-01 .. 2026-04-07: Wed..Tue. Weekend = Apr 4 (Sat), Apr 5 (Sun).
    CalendarEntry.objects.create(type="holiday", date="2026-04-02", name="X")
    AttendanceRecord.objects.create(
        employee=employee,
        attendance_date="2026-04-01",
        status="present",
        working_minutes=480,
    )

    response = client.get(SUMMARY_URL, {"from": "2026-04-01", "to": "2026-04-07"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total_days"] == 7
    assert data["holiday_days"] == 1
    assert data["weekend_days"] == 2
    assert data["working_days"] == 4  # 7 - 2 weekend - 1 holiday
    assert data["present_days"] == 1
    assert data["total_working_minutes"] == 480


def test_break_start_and_end_round_trip():
    client, _ = _client()
    client.post(CHECK_IN, {}, format="json")

    start_response = client.post(BREAK_START, {}, format="json")
    assert start_response.status_code == 200
    assert start_response.json()["data"]["on_break"] is True

    end_response = client.post(BREAK_END, {}, format="json")
    assert end_response.status_code == 200
    data = end_response.json()["data"]
    assert data["on_break"] is False
    assert data["break_minutes"] >= 0


def test_break_start_without_check_in_is_rejected():
    client, _ = _client()

    assert client.post(BREAK_START, {}, format="json").status_code == 400


def test_double_break_start_is_rejected():
    client, _ = _client()
    client.post(CHECK_IN, {}, format="json")
    client.post(BREAK_START, {}, format="json")

    assert client.post(BREAK_START, {}, format="json").status_code == 400


def test_break_end_without_break_start_is_rejected():
    client, _ = _client()
    client.post(CHECK_IN, {}, format="json")

    assert client.post(BREAK_END, {}, format="json").status_code == 400


def test_history_query_count_does_not_scale_with_range_length(django_assert_max_num_queries):
    """Regression test: get_day_facts_range() must fetch WeekOff/RecurringWfhRule/
    CalendarEntry/LeaveRequest once for the whole range, not once per day — a
    30-day history call used to issue 90+ queries before this was fixed
    (found during manual verification, reported as UI lag)."""
    client, _ = _client()

    with django_assert_max_num_queries(15):
        response = client.get(HISTORY_URL, {"from": "2026-05-01", "to": "2026-05-30"})

    assert response.status_code == 200
    assert len(response.json()["data"]) == 30
