import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import AttendanceRecord
from audit.models import AuditLog
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

CHECK_IN = "/api/v1/attendance/check-in"
CHECK_OUT = "/api/v1/attendance/check-out"


def _client(role_name="Employee"):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def test_anonymous_is_401():
    assert APIClient().post(CHECK_IN, {}, format="json").status_code == 401


def test_account_with_no_employee_record_is_403():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.post(CHECK_IN, {}, format="json").status_code == 403


def test_check_in_creates_a_present_record():
    client, employee = _client()

    response = client.post(CHECK_IN, {"notes": "wfh internet issue"}, format="json")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] == "present"
    assert data["source"] == "self"
    assert data["organization_id"] == "org-1"
    assert data["employee_id"] == str(employee.pk)
    assert data["clock_in_time"] is not None
    assert data["clock_out_time"] is None
    assert data["notes"] == "wfh internet issue"
    assert AuditLog.objects.filter(action="AttendanceRecord.checked_in").exists()


def test_double_check_in_is_rejected():
    client, _ = _client()
    client.post(CHECK_IN, {}, format="json")

    response = client.post(CHECK_IN, {}, format="json")

    assert response.status_code == 400


def test_check_out_without_check_in_is_rejected():
    client, _ = _client()

    assert client.post(CHECK_OUT, {}, format="json").status_code == 400


def test_check_out_computes_working_minutes():
    client, employee = _client()
    client.post(CHECK_IN, {}, format="json")
    record = AttendanceRecord.objects.get(employee=employee, attendance_date=timezone.localdate())
    record.clock_in_time = timezone.now() - timezone.timedelta(hours=8)
    record.save(update_fields=["clock_in_time"])

    response = client.post(CHECK_OUT, {}, format="json")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["clock_out_time"] is not None
    assert 470 <= data["working_minutes"] <= 480  # ~8 hours, allowing for test runtime
    assert AuditLog.objects.filter(action="AttendanceRecord.checked_out").exists()


def test_double_check_out_is_rejected():
    client, _ = _client()
    client.post(CHECK_IN, {}, format="json")
    client.post(CHECK_OUT, {}, format="json")

    assert client.post(CHECK_OUT, {}, format="json").status_code == 400
