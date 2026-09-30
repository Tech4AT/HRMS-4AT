"""Directory writes: create and edit an employee, guarded by employees.write."""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from accounts.models import Role, User
from audit.models import AuditLog
from core.enums import ScopeTier
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import Employee

pytestmark = pytest.mark.django_db

URL = "/api/v1/employees/"


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    return _client_for(user)


def _writer(tier, **employee_fields):
    """Someone holding only employees.write (and read) at `tier`."""
    role = RoleFactory()
    for code in ("employees.read", "employees.write"):
        RolePermissionFactory(role=role, permission=PermissionFactory(code=code), scope_tier=tier)
    user = UserFactory(role=role)
    employee = EmployeeFactory(user=user, **employee_fields)
    return _client_for(user), employee


def _body(**overrides):
    body = {
        "first_name": "Nia",
        "last_name": "North",
        "work_email": "nia.north@example.com",
        "employee_code": "T-0001",
    }
    return {**body, **overrides}


# --- create -----------------------------------------------------------------


def test_hr_creates_an_employee_with_a_login_that_cannot_be_used_yet():
    department = DepartmentFactory()

    response = _hr().post(URL, _body(department_id=department.pk), format="json")

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["employee_code"] == "T-0001"
    assert data["department_id"] == str(department.pk)
    user = User.objects.get(email="nia.north@example.com")
    assert user.has_usable_password() is False
    assert list(user.roles.values_list("name", flat=True)) == ["Employee"]
    assert AuditLog.objects.filter(action="Employee.created", entity_id=data["id"]).exists()


def test_a_role_in_the_request_body_is_ignored():
    """employees.write must not be a way to assign roles; that is roles.manage."""
    _hr().post(URL, _body(role="HR Admin", role_id=1), format="json")

    assert list(User.objects.get(email="nia.north@example.com").roles.values_list("name", flat=True)) == ["Employee"]


def test_duplicate_email_and_employee_code_are_rejected_with_field_errors():
    existing = EmployeeFactory(employee_code="T-0001")

    response = _hr().post(
        URL, _body(work_email=existing.user.email.upper(), employee_code="T-0001"), format="json"
    )

    assert response.status_code == 400
    fields = response.json()["error"]["fields"]
    assert "work_email" in fields and "employee_code" in fields


def test_someone_without_employees_write_cannot_create():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    EmployeeFactory(user=user)

    response = _client_for(user).post(URL, _body(), format="json")

    assert response.status_code == 403


def test_seeded_employee_role_no_longer_holds_write_at_all():
    assert (
        not Role.objects.get(name="Employee")
        .role_permissions.filter(permission__code="employees.write")
        .exists()
    )


def test_a_narrow_writer_cannot_create_someone_outside_their_own_scope_and_nothing_is_saved():
    department = DepartmentFactory()
    client, _ = _writer(ScopeTier.DEPARTMENT, department=department)

    response = client.post(URL, _body(), format="json")  # new person has no department

    assert response.status_code == 403
    assert not User.objects.filter(email="nia.north@example.com").exists()
    assert not Employee.objects.filter(employee_code="T-0001").exists()


def test_a_narrow_writer_can_create_inside_their_scope():
    department = DepartmentFactory()
    client, _ = _writer(ScopeTier.DEPARTMENT, department=department)

    response = client.post(URL, _body(department_id=department.pk), format="json")

    assert response.status_code == 201


# --- update -----------------------------------------------------------------


def test_hr_edits_an_employee_and_the_change_is_audited_with_before_and_after():
    employee = EmployeeFactory()
    department = DepartmentFactory()

    response = _hr().patch(
        f"{URL}{employee.pk}/",
        {"department_id": department.pk, "first_name": "Renamed"},
        format="json",
    )

    assert response.status_code == 200
    employee.refresh_from_db()
    assert employee.department_id == department.pk
    assert employee.user.first_name == "Renamed"
    entry = AuditLog.objects.get(action="Employee.updated", entity_id=str(employee.pk))
    assert entry.diff["before"]["department_id"] is None
    assert entry.diff["after"]["department_id"] == str(department.pk)


def test_a_team_writer_edits_a_report_but_not_a_stranger():
    client, boss = _writer(ScopeTier.TEAM)
    report = EmployeeFactory(manager=boss)
    stranger = EmployeeFactory()
    department = DepartmentFactory()

    ok = client.patch(f"{URL}{report.pk}/", {"department_id": department.pk}, format="json")
    denied = client.patch(f"{URL}{stranger.pk}/", {"department_id": department.pk}, format="json")

    assert ok.status_code == 200
    assert denied.status_code == 403


def test_a_writer_cannot_point_an_employee_at_a_manager_outside_their_scope():
    client, boss = _writer(ScopeTier.TEAM)
    report = EmployeeFactory(manager=boss)
    outsider = EmployeeFactory()

    response = client.patch(f"{URL}{report.pk}/", {"manager_id": outsider.pk}, format="json")

    assert response.status_code == 403
    report.refresh_from_db()
    assert report.manager_id == boss.pk


def test_an_edit_that_would_move_someone_out_of_scope_is_refused_and_rolled_back():
    home = DepartmentFactory()
    elsewhere = DepartmentFactory()
    client, _ = _writer(ScopeTier.DEPARTMENT, department=home)
    colleague = EmployeeFactory(department=home)

    response = client.patch(f"{URL}{colleague.pk}/", {"department_id": elsewhere.pk}, format="json")

    assert response.status_code == 403
    colleague.refresh_from_db()
    assert colleague.department_id == home.pk


def test_an_employee_cannot_edit_their_own_record():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    me = EmployeeFactory(user=user)

    response = _client_for(user).patch(f"{URL}{me.pk}/", {"first_name": "Hacker"}, format="json")

    assert response.status_code == 403


def test_a_manager_cannot_be_their_own_manager():
    employee = EmployeeFactory()

    response = _hr().patch(f"{URL}{employee.pk}/", {"manager_id": employee.pk}, format="json")

    assert response.status_code == 400
    assert "manager_id" in response.json()["error"]["fields"]


def test_a_circular_reporting_line_is_rejected():
    top = EmployeeFactory()
    middle = EmployeeFactory(manager=top)
    bottom = EmployeeFactory(manager=middle)

    response = _hr().patch(f"{URL}{top.pk}/", {"manager_id": bottom.pk}, format="json")

    assert response.status_code == 400
    assert "circular" in " ".join(response.json()["error"]["fields"]["manager_id"]).lower()
    top.refresh_from_db()
    assert top.manager_id is None


def test_put_and_delete_are_not_available():
    employee = EmployeeFactory()
    hr = _hr()

    assert hr.put(f"{URL}{employee.pk}/", _body(), format="json").status_code == 405
    assert hr.delete(f"{URL}{employee.pk}/").status_code == 405


# --- leaving and returning ----------------------------------------------------


def test_exiting_an_employee_ends_their_access_immediately():
    employee = EmployeeFactory()
    refresh = RefreshToken.for_user(employee.user)

    response = _hr().patch(f"{URL}{employee.pk}/", {"status": "exited"}, format="json")

    assert response.status_code == 200
    employee.user.refresh_from_db()
    assert employee.user.is_active is False
    assert BlacklistedToken.objects.filter(token__jti=refresh["jti"]).exists()
    entry = AuditLog.objects.get(action="Employee.exited", entity_id=str(employee.pk))
    assert entry.diff["sessionsRevoked"] >= 1


def test_reactivating_an_exited_employee_restores_their_login():
    employee = EmployeeFactory(status="exited")
    employee.user.is_active = False
    employee.user.save()

    _hr().patch(f"{URL}{employee.pk}/", {"status": "active"}, format="json")

    employee.user.refresh_from_db()
    assert employee.user.is_active is True
    assert AuditLog.objects.filter(action="Employee.reactivated").exists()


def test_putting_someone_on_leave_does_not_touch_their_login():
    employee = EmployeeFactory()

    _hr().patch(f"{URL}{employee.pk}/", {"status": "on_leave"}, format="json")

    employee.user.refresh_from_db()
    assert employee.user.is_active is True


# --- reporting lines: two-tier gating (admin vs manager) --------------------
# Proves the objective end-to-end through the real seeded roles, not synthetic
# ones: an HR Admin (employees.write ALL) may repoint anyone; a Manager
# (employees.write TEAM, seeded by migration 0015) may repoint only within
# their own subtree, and the change shows up on the directory read.


def _manager_client():
    """A user holding the real 'Manager' role, with their own employee record."""
    user = UserFactory(role=Role.objects.get(name="Manager"))
    boss = EmployeeFactory(user=user)
    return _client_for(user), boss


def test_admin_can_set_any_managers_reporting_line():
    a = EmployeeFactory()
    b = EmployeeFactory()

    response = _hr().patch(f"{URL}{a.pk}/", {"manager_id": b.pk}, format="json")

    assert response.status_code == 200
    a.refresh_from_db()
    assert a.manager_id == b.pk


def test_manager_repoints_a_report_within_their_own_subtree():
    client, boss = _manager_client()
    lead = EmployeeFactory(manager=boss)  # direct report
    junior = EmployeeFactory(manager=lead)  # indirect report (subtree)

    # Move the indirect report to report straight to the boss — both ends are
    # inside the manager's TEAM scope.
    response = client.patch(f"{URL}{junior.pk}/", {"manager_id": boss.pk}, format="json")

    assert response.status_code == 200
    junior.refresh_from_db()
    assert junior.manager_id == boss.pk


def test_manager_cannot_touch_a_report_outside_their_subtree():
    client, _boss = _manager_client()
    stranger = EmployeeFactory()  # not under this manager
    other = EmployeeFactory()

    response = client.patch(f"{URL}{stranger.pk}/", {"manager_id": other.pk}, format="json")

    assert response.status_code == 403
    stranger.refresh_from_db()
    assert stranger.manager_id != other.pk


def test_manager_cannot_point_a_report_at_a_manager_outside_their_subtree():
    client, boss = _manager_client()
    report = EmployeeFactory(manager=boss)
    outsider = EmployeeFactory()  # outside the subtree

    response = client.patch(f"{URL}{report.pk}/", {"manager_id": outsider.pk}, format="json")

    assert response.status_code == 403
    report.refresh_from_db()
    assert report.manager_id == boss.pk


def test_a_reporting_line_change_is_visible_on_the_directory_read():
    a = EmployeeFactory()
    b = EmployeeFactory()

    _hr().patch(f"{URL}{a.pk}/", {"manager_id": b.pk}, format="json")

    detail = _hr().get(f"{URL}{a.pk}/")
    assert detail.status_code == 200
    assert detail.json()["data"]["manager_id"] == str(b.pk)
