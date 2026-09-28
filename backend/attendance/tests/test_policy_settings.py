import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.models import PolicySettings
from audit.models import AuditLog
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/attendance/policy-settings"

_FULL_PAYLOAD = {
    "regularisationGraceDays": 5,
    "abscondingThresholdDays": 7,
    "noAttendance": {"enabled": True, "leaveDaysDeducted": 1},
    "lateArrival": {"enabled": True, "leaveDaysDeducted": 0.5, "thresholdCount": 4},
    "earlyLeaving": {"enabled": False, "leaveDaysDeducted": 0.5, "thresholdCount": 3},
    "workHours": {"enabled": False, "leaveDaysDeducted": 0.5, "minWorkHours": 8},
    "compOffAccrual": {"enabled": True, "overtimeHoursPerCompOff": 6},
}


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _hr_client():
    return _client("HR Admin")


def test_anonymous_is_401():
    assert APIClient().get(URL).status_code == 401


@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_roles_without_attendance_settings_manage_are_refused(role):
    client, _ = _client(role)

    assert client.get(URL).status_code == 403
    assert client.put(URL, _FULL_PAYLOAD, format="json").status_code == 403


def test_get_lazily_creates_the_singleton_with_defaults():
    client, _ = _hr_client()
    assert not PolicySettings.objects.exists()

    response = client.get(URL)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["regularisationGraceDays"] == 3
    # noAttendance shares RuleConfigSerializer with the other three rules, so
    # thresholdCount/minWorkHours are always present, null when a rule
    # (like this one) doesn't use them — matches the frontend's own single
    # PenalisationRuleConfig type used for every rule kind.
    assert data["noAttendance"] == {
        "enabled": True,
        "leaveDaysDeducted": "1.0",
        "thresholdCount": None,
        "minWorkHours": None,
    }
    assert data["compOffAccrual"] == {"enabled": True, "overtimeHoursPerCompOff": "8.0"}
    assert PolicySettings.objects.count() == 1


def test_put_replaces_the_whole_settings_object():
    client, _ = _hr_client()
    client.get(URL)  # lazily create it first

    response = client.put(URL, _FULL_PAYLOAD, format="json")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["regularisationGraceDays"] == 5
    assert data["lateArrival"] == {
        "enabled": True,
        "leaveDaysDeducted": "0.5",
        "thresholdCount": 4,
        "minWorkHours": None,
    }
    assert data["compOffAccrual"] == {"enabled": True, "overtimeHoursPerCompOff": "6.0"}
    assert PolicySettings.objects.count() == 1  # still the one row
    assert AuditLog.objects.filter(action="PolicySettings.updated").exists()


def test_put_requires_the_full_nested_shape():
    client, _ = _hr_client()

    response = client.put(URL, {"regularisationGraceDays": 5}, format="json")

    assert response.status_code == 400
