import pytest
from rest_framework.test import APIClient

from accounts.factories import RoleFactory, UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


def _hr():
    user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def test_an_admin_cannot_remove_their_own_last_roles_manage_role():
    # E6: dropping the last membership that grants roles.manage is a 403
    # and changes nothing (the atomic update rolls back).
    client, me = _hr()
    plain_role = RoleFactory()

    response = client.patch(f"/api/v1/users/{me.pk}/", {"roleIds": [plain_role.pk]}, format="json")

    assert response.status_code == 403
    assert "another administrator" in response.json()["error"]["message"]
    me.refresh_from_db()
    assert list(me.roles.values_list("name", flat=True)) == ["HR Admin"]


def test_an_admin_can_change_their_own_roles_while_keeping_roles_manage():
    # Multi-role spirit of E6: an own-role change that keeps roles.manage
    # is allowed (the old single-role rule forbade any own change).
    client, me = _hr()
    extra = RoleFactory()

    response = client.patch(
        f"/api/v1/users/{me.pk}/",
        {"roleIds": [Role.objects.get(name="HR Admin").pk, extra.pk]},
        format="json",
    )

    assert response.status_code == 200
    me.refresh_from_db()
    assert set(me.roles.values_list("name", flat=True)) == {"HR Admin", extra.name}


def test_an_admin_cannot_deactivate_themselves():
    client, me = _hr()

    response = client.patch(f"/api/v1/users/{me.pk}/", {"isActive": False}, format="json")

    assert response.status_code == 403
    me.refresh_from_db()
    assert me.is_active is True


def test_an_admin_can_still_manage_someone_else():
    client, _ = _hr()
    colleague = UserFactory(role=RoleFactory())

    changed_role = client.patch(
        f"/api/v1/users/{colleague.pk}/",
        {"roleIds": [Role.objects.get(name="Manager").pk]},
        format="json",
    )
    deactivated = client.patch(f"/api/v1/users/{colleague.pk}/", {"isActive": False}, format="json")

    assert changed_role.status_code == 200 and deactivated.status_code == 200


def test_an_admin_patching_themselves_with_no_real_change_is_allowed():
    client, me = _hr()

    hr_admin = Role.objects.get(name="HR Admin")
    response = client.patch(f"/api/v1/users/{me.pk}/", {"roleIds": [hr_admin.pk]}, format="json")

    assert response.status_code == 200
