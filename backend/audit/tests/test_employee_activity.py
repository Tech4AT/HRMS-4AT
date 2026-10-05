"""Employee-activity feed (#3/#9/#10).

The Audit tab's employee-framed answer: per-employee rows (logins,
profile/role changes, lifecycle events) with filtering and noise
trimming. The raw system view at /api/v1/audit-log/ stays intact.
"""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from audit.service import write_audit
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/org/employee-activity/"
SYSTEM_URL = "/api/v1/audit-log/"


def _client(role_name=None):
    user = (
        UserFactory(role=Role.objects.get(name=role_name))
        if role_name
        else UserFactory(role=None)
    )
    employee = EmployeeFactory(user=user, first_name="Ada", last_name="Admin")
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user, employee


def _rows(response):
    return response.json()["results"]


def test_frames_rows_around_the_employee_with_category_and_summary():
    client, hr, _ = _client("HR Admin")
    report = EmployeeFactory(first_name="Ravi", last_name="Report")
    write_audit(hr, "auth.login_succeeded", "User", hr.pk)
    write_audit(hr, "Employee.updated", "Employee", report.pk, {"after": {"phone": "x"}})
    write_audit(hr, "User.role_changed", "User", report.user.pk)
    write_audit(hr, "auth.token_refreshed", "User", hr.pk)  # noise
    write_audit(hr, "test.action", "Test", 1)  # noise

    rows = _rows(client.get(URL))

    actions = [r["action"] for r in rows]
    assert "auth.token_refreshed" not in actions and "test.action" not in actions
    by_action = {r["action"]: r for r in rows}
    login = by_action["auth.login_succeeded"]
    assert login["category"] == "login"
    assert login["employee"]["id"] == hr.employee.pk
    assert login["actor"]["email"] == hr.email
    assert "signed in" in login["summary"]
    profile = by_action["Employee.updated"]
    assert profile["category"] == "profile"
    assert profile["employee"] == {
        "id": report.pk,
        "code": report.employee_code,
        "name": "Ravi Report",
    }
    assert by_action["User.role_changed"]["category"] == "role"
    # Newest first.
    assert rows == sorted(rows, key=lambda r: r["id"], reverse=True)


def test_filters_by_employee_category_action_and_date():
    from datetime import timedelta

    from django.utils import timezone

    client, hr, _ = _client("HR Admin")
    report = EmployeeFactory(first_name="Ravi", last_name="Report")
    write_audit(hr, "auth.login_succeeded", "User", hr.pk)
    write_audit(hr, "Employee.updated", "Employee", report.pk)
    old = write_audit(hr, "auth.logout", "User", hr.pk)
    AuditLog.objects.filter(pk=old.pk).update(
        created_at=timezone.now() - timedelta(days=40)
    )

    assert {r["action"] for r in _rows(client.get(URL, {"employee": report.pk}))} == {
        "Employee.updated"
    }
    assert {r["action"] for r in _rows(client.get(URL, {"category": "login"}))} == {
        "auth.login_succeeded",
        "auth.logout",
    }
    assert [r["action"] for r in _rows(client.get(URL, {"action": "auth.logout"}))] == [
        "auth.logout"
    ]
    recent = _rows(
        client.get(
            URL,
            {
                "date_from": (timezone.now() - timedelta(days=7)).date().isoformat(),
                "date_to": timezone.now().date().isoformat(),
            },
        )
    )
    assert "auth.logout" not in {r["action"] for r in recent}
    assert client.get(URL, {"category": "bogus"}).status_code == 400


def test_subjectless_rows_never_enter_the_feed():
    client, hr, _ = _client("HR Admin")
    write_audit(None, "auth.login_failed", "User", 999999, {"email": "ghost@x.com"})
    write_audit(hr, "auth.login_succeeded", "User", hr.pk)

    rows = _rows(client.get(URL))

    assert [r["action"] for r in rows] == ["auth.login_succeeded"]


def test_gate_mirrors_the_system_view():
    write_audit(None, "test.action", "Test", 1)
    for role in ("Employee", "Manager", "Finance"):
        assert _client(role)[0].get(URL).status_code == 403
    assert APIClient().get(URL).status_code == 401
    # ...and the raw system view is untouched.
    client, _, _ = _client("HR Admin")
    system = client.get(SYSTEM_URL)
    assert system.status_code == 200 and system.json()["total"] >= 1
