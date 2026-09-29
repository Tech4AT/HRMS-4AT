import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import DepartmentFactory, EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/attendance/team/daily"


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def test_anonymous_is_401():
    assert APIClient().get(f"{URL}?from=2026-03-01&to=2026-03-01").status_code == 401


def test_employee_with_neither_approve_permission_is_403():
    client, _ = _client("Employee")

    response = client.get(f"{URL}?from=2026-03-01&to=2026-03-01")

    assert response.status_code == 403


def test_manager_sees_only_their_own_reports_and_themselves():
    manager_client, manager = _client("Manager")
    report = EmployeeFactory(manager=manager)
    stranger = EmployeeFactory(manager=EmployeeFactory())

    response = manager_client.get(f"{URL}?from=2026-03-01&to=2026-03-01")

    assert response.status_code == 200
    ids = {row["employee_id"] for row in response.json()["data"]}
    assert str(manager.pk) in ids
    assert str(report.pk) in ids
    assert str(stranger.pk) not in ids


def test_hr_admin_sees_every_active_employee():
    hr_client, hr_admin = _client("HR Admin")
    other = EmployeeFactory()
    exited = EmployeeFactory(status="exited")

    response = hr_client.get(f"{URL}?from=2026-03-01&to=2026-03-01")

    ids = {row["employee_id"] for row in response.json()["data"]}
    assert str(hr_admin.pk) in ids
    assert str(other.pk) in ids
    assert str(exited.pk) not in ids


def test_returns_one_row_per_employee_per_day_in_the_window():
    hr_client, hr_admin = _client("HR Admin")

    response = hr_client.get(f"{URL}?from=2026-03-01&to=2026-03-03")

    rows = [r for r in response.json()["data"] if r["employee_id"] == str(hr_admin.pk)]
    assert {r["attendance_date"] for r in rows} == {"2026-03-01", "2026-03-02", "2026-03-03"}


def test_response_includes_department_and_day_view_fields():
    department = DepartmentFactory(name="Technology")
    hr_client, hr_admin = _client("HR Admin")
    hr_admin.department = department
    hr_admin.save(update_fields=["department"])

    response = hr_client.get(f"{URL}?from=2026-03-01&to=2026-03-01")

    row = next(r for r in response.json()["data"] if r["employee_id"] == str(hr_admin.pk))
    assert row["department"] == "Technology"
    assert row["employee_name"]
    assert "status" in row
    assert "working_minutes" in row
    assert "is_weekend" in row


def test_month_query_param_is_accepted():
    hr_client, hr_admin = _client("HR Admin")

    response = hr_client.get(f"{URL}?month=2026-02")

    rows = [r for r in response.json()["data"] if r["employee_id"] == str(hr_admin.pk)]
    assert len(rows) == 28  # Feb 2026 is not a leap year


def test_missing_window_params_is_400():
    hr_client, _ = _client("HR Admin")

    response = hr_client.get(URL)

    assert response.status_code == 400
