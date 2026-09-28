"""UserViewSet — role assignment and admin-driven password reset
(docs/TASKS.md P1-E4-03). Without a way to assign a user to a role, custom
role/permission CRUD is inert — this is the missing link that makes RBAC
actually usable end to end."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from accounts.models import User
from audit.models import AuditLog
from core.enums import ScopeTier
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    manage_permission = PermissionFactory(code="roles.manage")
    admin_role = RoleFactory(name="Test Admin")
    RolePermissionFactory(role=admin_role, permission=manage_permission, scope_tier=ScopeTier.ALL)
    admin_user = UserFactory(role=admin_role)
    EmployeeFactory(user=admin_user)

    client = APIClient()
    client.force_authenticate(user=admin_user)
    return client, admin_user


def test_non_admin_cannot_list_users():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.get("/api/v1/users/")

    assert resp.status_code == 403


def test_admin_can_assign_role_to_a_user(admin_client):
    client, _ = admin_client
    target_role = RoleFactory(name="Target Role")
    target_user = UserFactory(role=None)
    EmployeeFactory(user=target_user)

    resp = client.patch(
        f"/api/v1/users/{target_user.pk}/", {"roleIds": [target_role.pk]}, format="json"
    )

    assert resp.status_code == 200
    target_user.refresh_from_db()
    assert list(target_user.roles.values_list("pk", flat=True)) == [target_role.pk]


def test_role_assignment_is_audited(admin_client):
    client, admin_user = admin_client
    target_role = RoleFactory(name="Audited Role")
    target_user = UserFactory(role=None)
    EmployeeFactory(user=target_user)

    client.patch(
        f"/api/v1/users/{target_user.pk}/", {"roleIds": [target_role.pk]}, format="json"
    )

    log = AuditLog.objects.get(action="User.role_changed", entity_id=str(target_user.pk))
    assert log.actor == admin_user
    assert log.diff["before"]["roles"] == []
    assert log.diff["after"]["roles"] == ["Audited Role"]


def test_password_reset_returns_a_working_temporary_password(admin_client):
    client, admin_user = admin_client
    target_user = UserFactory()
    EmployeeFactory(user=target_user)

    resp = client.post(f"/api/v1/users/{target_user.pk}/reset-password/")

    assert resp.status_code == 200
    temp_password = resp.json()["data"]["temporaryPassword"]
    assert temp_password

    target_user.refresh_from_db()
    assert target_user.check_password(temp_password)


def test_password_reset_is_audited(admin_client):
    client, admin_user = admin_client
    target_user = UserFactory()
    EmployeeFactory(user=target_user)

    client.post(f"/api/v1/users/{target_user.pk}/reset-password/")

    log = AuditLog.objects.get(action="User.password_reset", entity_id=str(target_user.pk))
    assert log.actor == admin_user
    # the password itself must never appear in the audit trail
    assert "password" not in str(log.diff).lower() or log.diff == {}


def test_non_admin_cannot_reset_passwords():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)
    target = UserFactory()
    EmployeeFactory(user=target)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post(f"/api/v1/users/{target.pk}/reset-password/")

    assert resp.status_code == 403


def test_user_search_filters_by_email(admin_client):
    client, _ = admin_client
    match = UserFactory(email="findme@example.com")
    EmployeeFactory(user=match)
    other = UserFactory(email="other@example.com")
    EmployeeFactory(user=other)

    resp = client.get("/api/v1/users/?search=findme")

    emails = {u["email"] for u in resp.json()["results"]}
    assert emails == {"findme@example.com"}


# --- code-review fix: UserViewSet must not expose create/destroy ---


def test_user_create_is_not_allowed(admin_client):
    """UserSerializer's email/name fields are read-only, so a POST couldn't
    produce a valid account anyway — the endpoint shouldn't accept the verb
    at all. User provisioning goes through import_employee_directory /
    createinitialadmin, not this admin surface."""
    client, _ = admin_client

    resp = client.post(
        "/api/v1/users/", {"email": "new@example.com", "firstName": "New"}, format="json"
    )

    assert resp.status_code == 405


def test_user_destroy_is_not_allowed(admin_client):
    """Hard-deleting a User cascades to their linked Employee record — too
    destructive for this endpoint, and previously went entirely unaudited."""
    client, _ = admin_client
    target = UserFactory()
    EmployeeFactory(user=target)

    resp = client.delete(f"/api/v1/users/{target.pk}/")

    assert resp.status_code == 405
    assert User.objects.filter(pk=target.pk).exists()


# --- code-review fix: is_active changes must be audited separately from role changes ---


def test_active_status_change_is_audited_distinctly_from_role_change(admin_client):
    client, admin_user = admin_client
    target = UserFactory(is_active=True)
    EmployeeFactory(user=target)

    resp = client.patch(f"/api/v1/users/{target.pk}/", {"isActive": False}, format="json")

    assert resp.status_code == 200
    log = AuditLog.objects.get(action="User.active_status_changed", entity_id=str(target.pk))
    assert log.actor == admin_user
    assert log.diff["before"]["isActive"] is True
    assert log.diff["after"]["isActive"] is False
    # A pure is_active change must NOT also produce a misleading
    # "role_changed" entry with identical before/after role.
    assert not AuditLog.objects.filter(
        action="User.role_changed", entity_id=str(target.pk)
    ).exists()


def test_role_only_change_does_not_log_active_status_changed(admin_client):
    client, _ = admin_client
    target_role = RoleFactory(name="Distinct Role Change Test")
    target = UserFactory(role=None, is_active=True)
    EmployeeFactory(user=target)

    client.patch(f"/api/v1/users/{target.pk}/", {"roleIds": [target_role.pk]}, format="json")

    assert not AuditLog.objects.filter(
        action="User.active_status_changed", entity_id=str(target.pk)
    ).exists()
    assert AuditLog.objects.filter(action="User.role_changed", entity_id=str(target.pk)).exists()


def test_changing_both_role_and_active_status_logs_both_events(admin_client):
    client, _ = admin_client
    target_role = RoleFactory(name="Both Changed Role")
    target = UserFactory(role=None, is_active=True)
    EmployeeFactory(user=target)

    client.patch(
        f"/api/v1/users/{target.pk}/",
        {"roleIds": [target_role.pk], "isActive": False},
        format="json",
    )

    assert AuditLog.objects.filter(action="User.role_changed", entity_id=str(target.pk)).exists()
    assert AuditLog.objects.filter(
        action="User.active_status_changed", entity_id=str(target.pk)
    ).exists()
