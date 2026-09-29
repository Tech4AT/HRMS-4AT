"""Assets module: import, RBAC registration, and scope enforcement."""

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from accounts.factories import RoleFactory, RolePermissionFactory, UserFactory
from accounts.models import Permission, Role
from assets.models import Asset
from core.enums import ScopeTier
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/assets/"

CSV = """CONSULT-4AT,,,,,,,,,,,
LAPTOP INFORMATION,,,,,,,,,,,
S.No,EMP NAME,LAPTOP NAME,BRAND,SERIAL,PROCESSOR,RAM,DATE OF ALLOTMENT,BAG,DATE OF RECOVER,PREVIOUSLY USED,notes
1,Asha Rao,4AT-T001,DELL,AAA111,I5,8GB,10/17/2022,Yes,,komal history,ignore me 999
2,Not Assigned,4AT-T002,HP,BBB222,I3,4GB,,No,10/14/2022,,ignore me too
3,,4AT-T003,LENOVO,CCC333,I7,16GB,01/05/2023,Yes,,,
"""


@pytest.fixture
def csv_path(tmp_path):
    p = tmp_path / "asset_laptops.csv"
    p.write_text(CSV)
    return str(p)


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _it_admin_role():
    role, _ = Role.objects.get_or_create(name="it_admin")
    for code in ("assets.read", "assets.write"):
        perm = Permission.objects.get(code=code)
        RolePermissionFactory(role=role, permission=perm, scope_tier=ScopeTier.ALL)
    return role


def test_import_loads_and_is_idempotent(csv_path):
    call_command("import_assets", path=csv_path)
    assert Asset.objects.count() == 3
    first = Asset.objects.get(asset_tag="4AT-T001")
    assert first.brand == "DELL" and first.has_bag is True
    assert str(first.date_of_allotment) == "2022-10-17" and first.status == "available"
    second = Asset.objects.get(asset_tag="4AT-T002")
    assert second.assigned_to is None and second.status == "recovered"
    # "Asha Rao" matches no employee yet — unassigned, counted, not crashed.
    assert first.assigned_to is None
    call_command("import_assets", path=csv_path)
    assert Asset.objects.count() == 3


def test_import_matches_employee_by_name(csv_path):
    user = UserFactory(first_name="Asha", last_name="Rao")
    emp = EmployeeFactory(user=user)
    call_command("import_assets", path=csv_path)
    asset = Asset.objects.get(asset_tag="4AT-T001")
    assert asset.assigned_to_id == emp.pk and asset.status == "assigned"


def test_perms_registered_in_catalog():
    codes = set(Permission.objects.filter(code__startswith="assets.").values_list("code", flat=True))
    assert {"assets.read", "assets.write", "assets.manage"} <= codes


def test_hr_admin_lists_everything(csv_path):
    call_command("import_assets", path=csv_path)
    hr = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr)
    response = _client_for(hr).get(URL)
    assert response.status_code == 200, response.content[:200]
    assert response.data["total"] == 3


def test_it_admin_lists_everything(csv_path):
    call_command("import_assets", path=csv_path)
    user = UserFactory(role=_it_admin_role())
    EmployeeFactory(user=user)
    response = _client_for(user).get(URL)
    assert response.status_code == 200, response.content[:200]
    assert response.data["total"] == 3


def test_plain_employee_sees_only_own_asset(csv_path):
    user = UserFactory(first_name="Asha", last_name="Rao")
    EmployeeFactory(user=user)
    other = EmployeeFactory()
    call_command("import_assets", path=csv_path)
    asset = Asset.objects.get(asset_tag="4AT-T001")
    asset.assigned_to = user.employee
    asset.save()
    Asset.objects.filter(asset_tag="4AT-T003").update(assigned_to=other)

    response = _client_for(user).get(URL)
    assert response.status_code == 200
    assert [r["asset_tag"] for r in response.data["results"]] == ["4AT-T001"]

    # Out-of-scope detail is a 403, not a 404.
    other_asset = Asset.objects.get(asset_tag="4AT-T003")
    assert _client_for(user).get(f"{URL}{other_asset.pk}/").status_code == 403


def test_unassigned_detail_is_all_holders_only(csv_path):
    call_command("import_assets", path=csv_path)
    asset = Asset.objects.get(asset_tag="4AT-T002")  # unassigned
    assert asset.assigned_to_id is None

    it_user = UserFactory(role=_it_admin_role())
    EmployeeFactory(user=it_user)
    assert _client_for(it_user).get(f"{URL}{asset.pk}/").status_code == 200

    plain = UserFactory()
    EmployeeFactory(user=plain)
    assert _client_for(plain).get(f"{URL}{asset.pk}/").status_code == 403


def test_user_without_perm_is_blocked(csv_path):
    call_command("import_assets", path=csv_path)
    stranger = UserFactory()  # no employee record, no roles: no baseline
    assert _client_for(stranger).get(URL).status_code == 403


def test_write_gated_to_it_and_hr(csv_path):
    call_command("import_assets", path=csv_path)
    asset = Asset.objects.get(asset_tag="4AT-T002")

    it_user = UserFactory(role=_it_admin_role())
    EmployeeFactory(user=it_user)
    emp = EmployeeFactory()
    response = _client_for(it_user).patch(f"{URL}{asset.pk}/", {"assigned_to": emp.pk}, format="json")
    assert response.status_code == 200, response.content[:200]
    asset.refresh_from_db()
    assert asset.assigned_to_id == emp.pk

    plain = UserFactory()
    EmployeeFactory(user=plain)
    response = _client_for(plain).patch(f"{URL}{asset.pk}/", {"brand": "ACME"}, format="json")
    assert response.status_code == 403


def test_unauthenticated_is_blocked():
    assert APIClient().get(URL).status_code in (401, 403)
