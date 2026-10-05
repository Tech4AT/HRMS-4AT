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
from employees.org_seed import (
    DROPPED_DUPLICATE_COST_CENTER,
    DROPPED_DUPLICATE_DEPARTMENT,
    EXAMPLE_CIN,
    EXAMPLE_STREET,
    REAL_LEGAL_ENTITY_NAME,
    REAL_LOCATION_NAME,
    REAL_PARENT_DEPARTMENT,
    REAL_SUB_DEPARTMENTS,
    seed_keka_org_details,
)

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
    LegalEntity.objects.create(name=REAL_LEGAL_ENTITY_NAME, currency="", country="")
    EmployeeFactory()

    first = seed_keka_org_details()
    # Exactly one row: the exact-name match (migration 0002's "Default
    # Entity" is left alone when the real name exists).
    assert first["legal_entity_backfilled"] == 1
    assert first["bank_account"] >= 1
    assert first["pay_grade"] == 3 and first["band"] == 2
    # Signatories come from real employees only — never invented.
    assert first["authorized_signatory"] >= 1
    # No Hyderabad location / Audit & Assurance parent in this bare DB.
    assert first["location_backfilled"] == 0
    assert first["sub_department"] == 0
    # ROSTER IS SOURCE OF TRUTH: the empty Keka duplicates are never
    # created — not even in a bare DB.
    assert first["duplicate_cost_center_removed"] == 0
    assert first["duplicate_department_removed"] == 0
    assert CostCenter.objects.filter(name=DROPPED_DUPLICATE_COST_CENTER).count() == 0
    assert Department.objects.filter(name=DROPPED_DUPLICATE_DEPARTMENT).count() == 0

    entity = LegalEntity.objects.get(name=REAL_LEGAL_ENTITY_NAME)
    assert entity.legal_name == "4AT Consulting LLP"
    assert entity.company_identification_number == "AAT-0747"
    assert str(entity.date_of_incorporation) == "2020-07-25"
    assert entity.type_of_business == LegalEntity.TYPE_LIMITED_LIABILITY
    assert entity.sector == LegalEntity.SECTOR_PROFESSIONALS
    assert entity.nature_of_business == "Chartered Accountants, Auditors, etc. (601)"
    assert entity.address_line1.startswith("3rd Floor, D Block")
    assert entity.address_line2 == "Madhapur"
    assert entity.city == "Hyderabad" and entity.state == "Telangana"
    assert entity.zip_code == "500081" and entity.country == "India"
    assert entity.currency == "INR" and entity.financial_year == "april_march"
    assert entity.authorized_signatories.filter(is_active=True).exists()
    assert entity.bank_accounts.filter(is_active=True).exists()

    default_entity = LegalEntity.objects.get(name="Default Entity")
    assert default_entity.company_identification_number != "AAT-0747"

    second = seed_keka_org_details()
    assert all(v == 0 for v in second.values())


def test_seed_replaces_legacy_example_placeholders_with_real_values():
    LegalEntity.objects.create(
        name=REAL_LEGAL_ENTITY_NAME,
        company_identification_number=EXAMPLE_CIN,
        address_line1=EXAMPLE_STREET,
    )

    out = seed_keka_org_details()

    assert out["legal_entity_backfilled"] == 1
    entity = LegalEntity.objects.get(name=REAL_LEGAL_ENTITY_NAME)
    assert entity.company_identification_number == "AAT-0747"
    assert entity.address_line1.startswith("3rd Floor, D Block")
    assert str(entity.date_of_incorporation) == "2020-07-25"


def test_seed_falls_back_to_primary_entity_without_exact_name_match():
    # Only migration 0002's "Default Entity" exists — the real values go
    # on the primary/first row, which is reported, never renamed.
    out = seed_keka_org_details()

    assert out["legal_entity_backfilled"] == 1
    primary = LegalEntity.objects.order_by("id").first()
    assert primary.company_identification_number == "AAT-0747"
    assert str(primary.date_of_incorporation) == "2020-07-25"
    assert LegalEntity.objects.filter(name=REAL_LEGAL_ENTITY_NAME).count() == 0


def test_seed_backfills_hyderabad_location_only_when_present():
    Location.objects.create(name=REAL_LOCATION_NAME)

    out = seed_keka_org_details()

    assert out["location_backfilled"] == 1
    loc = Location.objects.get(name=REAL_LOCATION_NAME)
    assert loc.address_line1.startswith("3rd Floor, D Block")
    assert loc.address_line2 == "Madhapur"
    assert loc.city == "Hyderabad" and loc.state == "Telangana"
    assert loc.country == "India" and loc.postal_code == "500081"
    assert loc.timezone == "Asia/Kolkata"
    assert loc.description == "Indian Office"
    # Blank in Keka — never fabricated.
    assert loc.email_alias == "" and loc.location_head_id is None

    assert seed_keka_org_details()["location_backfilled"] == 0


def test_seed_skips_location_when_absent():
    out = seed_keka_org_details()

    assert out["location_backfilled"] == 0
    assert Location.objects.filter(name=REAL_LOCATION_NAME).count() == 0


def test_seed_never_creates_the_dropped_keka_duplicates():
    # ROSTER IS SOURCE OF TRUTH: neither the Sensiba cost center nor the
    # assumed-spelling SOX department may come back, even in a bare DB.
    EmployeeFactory()

    out = seed_keka_org_details()

    assert out["duplicate_cost_center_removed"] == 0
    assert out["duplicate_department_removed"] == 0
    assert CostCenter.objects.filter(name=DROPPED_DUPLICATE_COST_CENTER).count() == 0
    assert Department.objects.filter(name=DROPPED_DUPLICATE_DEPARTMENT).count() == 0
    assert seed_keka_org_details()["duplicate_cost_center_removed"] == 0


def test_seed_removes_leftover_empty_duplicates_but_never_real_data():
    empty_cc = CostCenter.objects.create(name=DROPPED_DUPLICATE_COST_CENTER)
    empty_dept = DepartmentFactory(name=DROPPED_DUPLICATE_DEPARTMENT)
    holder = EmployeeFactory()
    lived_cc = CostCenter.objects.create(name="Lived CC")
    holder.cost_center = lived_cc
    holder.save()

    out = seed_keka_org_details()

    assert out["duplicate_cost_center_removed"] == 1
    assert out["duplicate_department_removed"] == 1
    assert not CostCenter.objects.filter(pk=empty_cc.pk).exists()
    assert not Department.objects.filter(pk=empty_dept.pk).exists()
    # Real data is never dropped.
    assert CostCenter.objects.filter(pk=lived_cc.pk).exists()

    assert seed_keka_org_details()["duplicate_cost_center_removed"] == 0
    assert seed_keka_org_details()["duplicate_department_removed"] == 0


def test_seed_keeps_a_duplicate_name_when_it_holds_people():
    dept = DepartmentFactory(name=DROPPED_DUPLICATE_DEPARTMENT)
    holder = EmployeeFactory()
    holder.department = dept
    holder.save()

    out = seed_keka_org_details()

    assert out["duplicate_department_removed"] == 0
    assert Department.objects.filter(pk=dept.pk).exists()


def test_seed_creates_audit_sub_departments_under_parent():
    parent = DepartmentFactory(name=REAL_PARENT_DEPARTMENT)

    out = seed_keka_org_details()

    assert out["sub_department"] == len(REAL_SUB_DEPARTMENTS) == 2
    assert set(REAL_SUB_DEPARTMENTS) == {
        "Venture Captial Audit",  # verbatim Keka spelling
        "InfoSec Audit",
    }
    for name in REAL_SUB_DEPARTMENTS:
        assert Department.objects.get(name=name).parent_id == parent.pk

    assert seed_keka_org_details()["sub_department"] == 0


def test_seed_skips_sub_departments_without_parent():
    out = seed_keka_org_details()

    assert out["sub_department"] == 0
    assert Department.objects.filter(name="InfoSec Audit").count() == 0


def test_seed_never_overwrites_a_human_edit():
    entity = LegalEntity.objects.create(name="Human Entity", city="Bengaluru")

    seed_keka_org_details()
    seed_keka_org_details()

    assert LegalEntity.objects.get(pk=entity.pk).city == "Bengaluru"
    assert LegalEntityBankAccount.objects.filter(legal_entity=entity).count() == 1
