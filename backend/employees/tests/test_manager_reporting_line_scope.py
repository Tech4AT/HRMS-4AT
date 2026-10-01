"""A Manager may change who their team reports to, and nothing else.

Organization asked for managers to view and reassign the reporting line of their
direct and indirect reports. An earlier implementation gave Manager the whole
employees.write permission at TEAM scope, which also let a manager edit any field of
a report, set them to `exited` (ending their access), rename them, or create
employees. The Manager role now holds employees.reporting_line.write instead, and
EmployeeViewSet accepts it only for a PATCH that sets nothing but `manager_id`."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from accounts.models import Role, RolePermission
from audit.models import AuditLog
from core.enums import ScopeTier
from core.registry import registered_permissions
from employees.factories import DepartmentFactory, EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/employees/"


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _manager():
    user = UserFactory(role=Role.objects.get(name="Manager"), first_name="Mara", last_name="Boss")
    return _client_for(user), EmployeeFactory(user=user)


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    return _client_for(user)


def _grants(role_name, code):
    return list(
        RolePermission.objects.filter(role__name=role_name, permission__code=code).values_list(
            "scope_tier", flat=True
        )
    )


# --- what the Manager role holds ------------------------------------------------------------


def test_the_manager_role_can_change_reporting_lines_in_its_team_but_not_edit_employees():
    assert _grants("Manager", "employees.reporting_line.write") == [ScopeTier.TEAM]
    assert _grants("Manager", "employees.write") == []
    # Seeing indirect reports is what the reporting-line screen needs.
    assert _grants("Manager", "employees.read") == [ScopeTier.TEAM]


def test_hr_admin_keeps_full_edit_and_reporting_line_rights_everywhere():
    assert _grants("HR Admin", "employees.write") == [ScopeTier.ALL]
    assert _grants("HR Admin", "employees.reporting_line.write") == [ScopeTier.ALL]


def test_the_registered_defaults_match_so_a_fresh_install_gets_the_same_roles():
    registry = registered_permissions()

    assert registry["employees.write"].default_grants == {"HR Admin": ScopeTier.ALL}
    assert registry["employees.reporting_line.write"].default_grants == {
        "HR Admin": ScopeTier.ALL,
        "Manager": ScopeTier.TEAM,
    }


# --- what a Manager may do ------------------------------------------------------------------


def test_a_manager_repoints_an_indirect_report_within_their_team():
    client, boss = _manager()
    lead = EmployeeFactory(manager=boss)
    junior = EmployeeFactory(manager=lead)

    response = client.patch(f"{URL}{junior.pk}/", {"manager_id": boss.pk}, format="json")

    assert response.status_code == 200
    junior.refresh_from_db()
    assert junior.manager_id == boss.pk
    assert AuditLog.objects.filter(action="Employee.updated", entity_id=str(junior.pk)).exists()


# --- what a Manager may not do --------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"status": "exited"},
        {"status": "on_leave"},
        {"date_of_exit": "2026-12-31"},
        {"employment_type": "contract"},
        {"first_name": "Renamed"},
        {"work_email": "taken-over@example.com"},
        {"employee_code": "HACKED"},
        {"manager_id": None, "status": "exited"},
    ],
)
def test_a_manager_cannot_edit_any_other_field_of_a_report(body):
    client, boss = _manager()
    report = EmployeeFactory(manager=boss)
    before = (report.status, report.employment_type, report.employee_code, report.manager_id)

    response = client.patch(f"{URL}{report.pk}/", body, format="json")

    assert response.status_code == 403
    report.refresh_from_db()
    assert (
        report.status,
        report.employment_type,
        report.employee_code,
        report.manager_id,
    ) == before
    assert report.user.is_active is True


def test_a_manager_cannot_slip_another_change_in_beside_a_reporting_line_change():
    client, boss = _manager()
    lead = EmployeeFactory(manager=boss)
    report = EmployeeFactory(manager=boss)
    department = DepartmentFactory()

    response = client.patch(
        f"{URL}{report.pk}/", {"manager_id": lead.pk, "department_id": department.pk}, format="json"
    )

    assert response.status_code == 403
    report.refresh_from_db()
    assert report.manager_id == boss.pk and report.department_id is None


def test_a_manager_cannot_exit_a_report_and_the_report_can_still_sign_in():
    client, boss = _manager()
    report = EmployeeFactory(manager=boss)

    response = client.patch(f"{URL}{report.pk}/", {"status": "exited"}, format="json")

    assert response.status_code == 403
    report.user.refresh_from_db()
    assert report.user.is_active is True


def test_a_manager_cannot_create_employees_even_under_themselves():
    client, boss = _manager()

    response = client.post(
        URL,
        {
            "first_name": "Zed",
            "last_name": "New",
            "work_email": "zed.new@example.com",
            "employee_code": "ZED-1",
            "manager_id": boss.pk,
        },
        format="json",
    )

    assert response.status_code == 403


def test_a_manager_cannot_detach_a_report_from_the_team():
    client, boss = _manager()
    report = EmployeeFactory(manager=boss)

    response = client.patch(f"{URL}{report.pk}/", {"manager_id": None}, format="json")

    assert response.status_code == 403  # the result would fall outside their scope
    report.refresh_from_db()
    assert report.manager_id == boss.pk


def test_a_manager_cannot_move_someone_outside_the_team_or_to_a_manager_outside_it():
    client, boss = _manager()
    report = EmployeeFactory(manager=boss)
    stranger = EmployeeFactory()
    outsider_boss = EmployeeFactory()

    assert (
        client.patch(f"{URL}{stranger.pk}/", {"manager_id": boss.pk}, format="json").status_code
        == 403
    )
    assert (
        client.patch(
            f"{URL}{report.pk}/", {"manager_id": outsider_boss.pk}, format="json"
        ).status_code
        == 403
    )
    report.refresh_from_db()
    assert report.manager_id == boss.pk


def test_a_manager_cannot_rename_a_report_through_employee_360():
    client, boss = _manager()
    report = EmployeeFactory(manager=boss, user=UserFactory(first_name="Eli", last_name="Egan"))

    response = client.patch(
        f"{URL}{report.pk}/profile/name/",
        {"first_name": "Eli", "last_name": "Renamed"},
        format="json",
    )

    assert response.status_code == 403
    report.user.refresh_from_db()
    assert report.user.last_name == "Egan"


# --- HR is unaffected -----------------------------------------------------------------------


def test_hr_can_still_edit_any_field_and_exit_someone():
    hr = _hr()
    person = EmployeeFactory()

    assert (
        hr.patch(f"{URL}{person.pk}/", {"employment_type": "contract"}, format="json").status_code
        == 200
    )
    assert hr.patch(f"{URL}{person.pk}/", {"status": "exited"}, format="json").status_code == 200
    person.user.refresh_from_db()
    assert person.user.is_active is False


# --- the permission works for any role, not just Manager ------------------------------------


def _custom(tier):
    role = RoleFactory()
    for code in ("employees.read", "employees.reporting_line.write"):
        RolePermissionFactory(role=role, permission=PermissionFactory(code=code), scope_tier=tier)
    user = UserFactory(role=role)
    return _client_for(user), EmployeeFactory(user=user)


def test_a_custom_role_with_only_the_reporting_line_permission_is_bounded_by_its_tier():
    client, boss = _custom(ScopeTier.MANAGER)  # direct reports only
    lead = EmployeeFactory(manager=boss)
    junior = EmployeeFactory(manager=lead)

    assert (
        client.patch(f"{URL}{lead.pk}/", {"manager_id": boss.pk}, format="json").status_code == 200
    )
    assert (
        client.patch(f"{URL}{junior.pk}/", {"manager_id": boss.pk}, format="json").status_code
        == 403
    )
    assert client.patch(f"{URL}{lead.pk}/", {"status": "exited"}, format="json").status_code == 403


def test_someone_with_no_edit_permission_at_all_is_refused():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    me = EmployeeFactory(user=user)
    other = EmployeeFactory(manager=me)

    assert (
        _client_for(user)
        .patch(f"{URL}{other.pk}/", {"manager_id": me.pk}, format="json")
        .status_code
        == 403
    )


# --- the data migration ---------------------------------------------------------------------


def test_the_migration_removes_the_team_grant_it_gave_and_leaves_a_customised_one():
    import importlib

    from django.apps import apps

    migration = importlib.import_module("accounts.migrations.0016_manager_reporting_line_only")
    manager = Role.objects.get(name="Manager")
    write = PermissionFactory(code="employees.write")

    # The state 0015 left behind: Manager holds employees.write at TEAM.
    RolePermission.objects.update_or_create(
        role=manager, permission=write, defaults={"scope_tier": ScopeTier.TEAM}
    )
    migration.take_back_manager_write(apps, None)
    assert _grants("Manager", "employees.write") == []

    # An administrator who deliberately widened it keeps their choice.
    RolePermission.objects.update_or_create(
        role=manager, permission=write, defaults={"scope_tier": ScopeTier.ALL}
    )
    migration.take_back_manager_write(apps, None)
    assert _grants("Manager", "employees.write") == [ScopeTier.ALL]

    # And the migration can be reversed.
    RolePermission.objects.filter(role=manager, permission=write).delete()
    migration.restore_manager_write(apps, None)
    assert _grants("Manager", "employees.write") == [ScopeTier.TEAM]
