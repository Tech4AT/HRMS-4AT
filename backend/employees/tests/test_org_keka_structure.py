"""Keka parity: LegalEntity registration fields, AuthorizedSignatory,
LegalEntityBankAccount, PayGrade/Band, email_alias/location_head, and the
seed_keka_org_details backfill (permission org.manage)."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import DepartmentFactory, EmployeeFactory
from employees.models import (
    AuthorizedSignatory,
    Band,
    CostCenter,
    Department,
    LegalEntity,
    LegalEntityBankAccount,
    Location,
    PayGrade,
)
from employees.org_seed import seed_keka_org_details

pytestmark = pytest.mark.django_db


def _client(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(kind, pk=None):
    return f"/api/v1/org/{kind}/" + (f"{pk}/" if pk else "")


# --- LegalEntity registration fields -----------------------------------------


def test_legal_entity_admin_exposes_registration_fields():
    hr = _client("HR Admin")
    entity = LegalEntity.objects.create(
        name="4AT Consulting LLP",
        legal_name="4AT Consulting LLP",
        company_identification_number="AAX-0000",
        type_of_business=LegalEntity.TYPE_LLP,
        sector=LegalEntity.SECTOR_PROFESSIONALS,
        nature_of_business="Chartered Accountants, Auditors, etc. (601)",
        address_line1="Hyderabad",
        city="Hyderabad",
        state="Telangana",
        zip_code="500001",
        financial_year=LegalEntity.FY_APR_MAR,
    )

    body = hr.get(_url("legal-entities", entity.pk)).json()

    assert body["legalName"] == "4AT Consulting LLP"
    assert body["companyIdentificationNumber"] == "AAX-0000"
    assert body["typeOfBusiness"] == "llp"
    assert body["sector"] == "professionals"
    assert body["natureOfBusiness"] == "Chartered Accountants, Auditors, etc. (601)"
    assert body["city"] == "Hyderabad" and body["financialYear"] == "april_march"

    patched = hr.patch(
        _url("legal-entities", entity.pk),
        {"date_of_incorporation": "2015-04-01", "zip_code": "500002"},
        format="json",
    )
    assert patched.status_code == 200
    assert patched.json()["dateOfIncorporation"] == "2015-04-01"


# --- AuthorizedSignatory ------------------------------------------------------


def test_hr_manages_signatories_scoped_to_one_entity_and_audited():
    hr = _client("HR Admin")
    entity = LegalEntity.objects.create(name="Entity A")
    other = LegalEntity.objects.create(name="Entity B")
    AuthorizedSignatory.objects.create(
        legal_entity=other, name="Other Person", designation="Director"
    )

    created = hr.post(
        _url("authorized-signatories"),
        {"legal_entity": entity.pk, "name": "Asha Rao", "designation": "Partner"},
        format="json",
    )
    assert created.status_code == 201
    pk = created.json()["id"]
    assert created.json()["legalEntityName"] == "Entity A"

    rows = hr.get(_url("authorized-signatories"), {"legal_entity": entity.pk}).json()["results"]
    assert [r["name"] for r in rows] == ["Asha Rao"]

    found = hr.get(_url("authorized-signatories"), {"search": "asha"}).json()["results"]
    assert [r["name"] for r in found] == ["Asha Rao"]

    assert hr.patch(_url("authorized-signatories", pk), {"email": "a@example.com"}, format="json").status_code == 200
    assert hr.delete(_url("authorized-signatories", pk)).status_code == 204
    assert not AuthorizedSignatory.objects.filter(pk=pk).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        "AuthorizedSignatory.created",
        "AuthorizedSignatory.updated",
        "AuthorizedSignatory.deleted",
    } <= actions


# --- LegalEntityBankAccount (endpoint: org/bank-details) -----------------------


def test_hr_manages_company_bank_accounts_scoped_to_one_entity_and_audited():
    hr = _client("HR Admin")
    entity = LegalEntity.objects.create(name="Entity A")

    created = hr.post(
        _url("bank-details"),
        {
            "legal_entity": entity.pk,
            "bank_name": "HDFC Bank",
            "account_number": "50100299998888",
            "ifsc_code": "HDFC0001234",
            "account_type": "current",
        },
        format="json",
    )
    assert created.status_code == 201
    pk = created.json()["id"]
    assert created.json()["legalEntityName"] == "Entity A"

    rows = hr.get(_url("bank-details"), {"legal_entity": entity.pk}).json()["results"]
    assert [r["accountNumber"] for r in rows] == ["50100299998888"]

    found = hr.get(_url("bank-details"), {"search": "hdfc"}).json()["results"]
    assert len(found) == 1

    assert hr.delete(_url("bank-details", pk)).status_code == 204
    assert not LegalEntityBankAccount.objects.filter(pk=pk).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        "LegalEntityBankAccount.created",
        "LegalEntityBankAccount.deleted",
    } <= actions


# --- PayGrade / Band (EXAMPLE placeholders) ------------------------------------


def test_hr_manages_pay_grades_and_bands_and_band_names_its_grade():
    hr = _client("HR Admin")

    grade = hr.post(
        _url("pay-grades"),
        {"name": "E1", "code": "E1", "min_pay": "300000", "max_pay": "500000"},
        format="json",
    )
    assert grade.status_code == 201
    grade_pk = grade.json()["id"]
    assert grade.json()["currency"] == "INR"

    band = hr.post(
        _url("bands"),
        {"name": "Individual Contributor", "code": "IC", "pay_grade": grade_pk},
        format="json",
    )
    assert band.status_code == 201
    assert band.json()["payGradeName"] == "E1"

    assert PayGrade.objects.filter(pk=grade_pk).exists()
    assert Band.objects.filter(pay_grade_id=grade_pk).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"PayGrade.created", "Band.created"} <= actions


# --- email_alias / location_head ------------------------------------------------


def test_location_department_and_cost_center_carry_email_alias():
    hr = _client("HR Admin")
    head = EmployeeFactory()
    location = Location.objects.create(name="Hyderabad")

    patched = hr.patch(
        _url("locations", location.pk),
        {"location_head": head.pk, "email_alias": "hyd@consult-4at.com"},
        format="json",
    )
    assert patched.status_code == 200
    assert patched.json()["emailAlias"] == "hyd@consult-4at.com"
    assert patched.json()["locationHeadName"] == head.user.username

    dept = DepartmentFactory(name="Aliases")
    assert hr.patch(
        _url("departments", dept.pk), {"email_alias": "aliases@example.com"}, format="json"
    ).status_code == 200
    assert Department.objects.get(pk=dept.pk).email_alias == "aliases@example.com"

    cc = CostCenter.objects.create(name="Alias CC")
    assert hr.patch(
        _url("cost-centers", cc.pk), {"email_alias": "cc@example.com"}, format="json"
    ).status_code == 200


# --- permissions -----------------------------------------------------------------


@pytest.mark.parametrize("kind", ["authorized-signatories", "bank-details", "pay-grades", "bands"])
@pytest.mark.parametrize("role", ["Employee", "Manager", "Finance"])
def test_only_holders_of_org_manage_can_use_the_new_endpoints(kind, role):
    client = _client(role)

    assert client.get(_url(kind)).status_code == 403
    assert client.post(_url(kind), {"name": "X"}, format="json").status_code == 403


# --- seed ------------------------------------------------------------------------


def test_seed_keka_org_details_backfills_and_is_idempotent():
    LegalEntity.objects.create(name="Seed Entity", currency="", country="")
    EmployeeFactory()

    first = seed_keka_org_details()
    # >= 1: migration 0002's "Default Entity" also exists in a migrated DB
    # and gets backfilled alongside the row created above.
    assert first["legal_entity_backfilled"] >= 1
    assert first["bank_account"] >= 1
    assert first["pay_grade"] == 3 and first["band"] == 2
    # Signatories come from real employees only — never invented.
    assert first["authorized_signatory"] >= 1

    entity = LegalEntity.objects.get(name="Seed Entity")
    assert entity.currency == "INR" and entity.financial_year == "april_march"
    assert entity.city == "Hyderabad" and entity.country == "India"
    assert entity.date_of_incorporation is None  # no verified source: left NULL
    assert entity.authorized_signatories.filter(is_active=True).exists()
    assert entity.bank_accounts.filter(is_active=True).exists()

    second = seed_keka_org_details()
    assert all(v == 0 for v in second.values())


def test_seed_never_overwrites_a_human_edit():
    entity = LegalEntity.objects.create(name="Human Entity", city="Bengaluru")

    seed_keka_org_details()
    seed_keka_org_details()

    assert LegalEntity.objects.get(pk=entity.pk).city == "Bengaluru"
    assert LegalEntityBankAccount.objects.filter(legal_entity=entity).count() == 1
