"""T06 — forced password change on first login (admin-set temp password model).

Covers acceptance 2/3/4/5 of docs/RBAC-TESTS.md [T06]:
- admin POST users/{id}/reset-password sets must_change_password=True
- login response and GET users/me expose mustChangePassword (camelCase)
- POST users/me/change-password clears the flag on success, and the new
  password actually works afterwards.
"""

import pytest
from rest_framework.test import APIClient

from accounts.factories import RoleFactory, UserFactory
from accounts.models import User
from core.enums import RoleArchetype
from core.permissions import HasPermissionCode  # noqa: F401  (perm registration side-effect)

pytestmark = pytest.mark.django_db

OLD = "Temp-Passw0rd-xyz-1"
NEW = "Brand-New-Passw0rd-42"


def _user_with_password(**kwargs):
    kwargs.setdefault("must_change_password", False)
    user = UserFactory(**kwargs)
    user.set_password(OLD)
    user.save(update_fields=["password"])
    return user


def _admin_client():
    """A client authenticated as a user holding roles.manage (required by
    UserViewSet.reset_password)."""
    from accounts.factories import PermissionFactory, RolePermissionFactory
    from core.enums import ScopeTier
    from employees.factories import EmployeeFactory

    permission = PermissionFactory(code="roles.manage")
    role = RoleFactory(name="T06 Admin", archetype=RoleArchetype.SUPERADMIN)
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    admin = UserFactory(role=role)
    EmployeeFactory(user=admin)
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def test_new_users_default_to_no_forced_change():
    user = UserFactory()
    assert user.must_change_password is False
    assert User.objects.get(pk=user.pk).must_change_password is False


def test_admin_reset_sets_the_flag_and_returns_a_working_temp_password():
    user = _user_with_password()
    assert user.must_change_password is False

    resp = _admin_client().post(f"/api/v1/users/{user.pk}/reset-password/")

    assert resp.status_code == 200, resp.content[:500]
    temp = resp.json()["data"]["temporaryPassword"]
    assert temp
    user.refresh_from_db()
    assert user.must_change_password is True
    assert user.check_password(temp)


def test_login_response_exposes_must_change_password():
    user = _user_with_password(must_change_password=True)
    client = APIClient()

    resp = client.post("/api/v1/auth/login", {"email": user.email, "password": OLD})

    assert resp.status_code == 200
    assert resp.json()["data"]["user"]["mustChangePassword"] is True


def test_login_response_reports_false_when_no_change_required():
    user = _user_with_password(must_change_password=False)
    client = APIClient()

    resp = client.post("/api/v1/auth/login", {"email": user.email, "password": OLD})

    assert resp.status_code == 200
    assert resp.json()["data"]["user"]["mustChangePassword"] is False


def test_me_exposes_must_change_password():
    user = _user_with_password(must_change_password=True)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.get("/api/v1/users/me")

    assert resp.status_code == 200
    assert resp.json()["data"]["mustChangePassword"] is True


def test_change_password_clears_the_flag_and_new_password_works():
    user = _user_with_password(must_change_password=True)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post(
        "/api/v1/users/me/change-password",
        {"currentPassword": OLD, "newPassword": NEW},
        format="json",
    )

    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.must_change_password is False
    assert user.check_password(NEW) and not user.check_password(OLD)

    # The new password works for a real login, which now reports no flag.
    login = APIClient().post("/api/v1/auth/login", {"email": user.email, "password": NEW})
    assert login.status_code == 200
    assert login.json()["data"]["user"]["mustChangePassword"] is False


def test_failed_change_does_not_clear_the_flag():
    user = _user_with_password(must_change_password=True)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post(
        "/api/v1/users/me/change-password",
        {"currentPassword": "wrong", "newPassword": NEW},
        format="json",
    )

    assert resp.status_code == 400
    user.refresh_from_db()
    assert user.must_change_password is True
