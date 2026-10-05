"""Employee 360 profile: `/employees/<id|me>/profile/…`.

One profile for everyone; what each caller sees and may change comes from
employees.profile_access. These tests pin that matrix per role, the field
validation, the legal-name sync between User and Employee, and the audit trail.
"""

from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.factories import PermissionFactory, UserFactory, UserPermissionOverrideFactory
from accounts.models import Role
from audit.models import AuditLog
from core.enums import ScopeTier
from employees.factories import EmployeeFactory
from employees.models import EmergencyContact, EmployeeAddress
from employees.profile_views import MAX_EMERGENCY_CONTACTS

pytestmark = pytest.mark.django_db


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _as(role_name, **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name), first_name="Pat", last_name="Lee")
    employee = EmployeeFactory(user=user, **employee_kwargs)
    return _client_for(user), employee


def _url(target="me", tail=""):
    return f"/api/v1/employees/{target}/profile/{tail}"


# --- reading ------------------------------------------------------------------------------


def test_a_person_reads_their_own_full_profile_through_me():
    client, me = _as("Employee", phone="555-0100", dob=date(1990, 1, 2))

    response = client.get(_url())

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["id"] == str(me.pk)
    assert data["first_name"] == "Pat" and data["last_name"] == "Lee"
    assert data["access"] == {
        "is_self": True,
        "can_read_personal": True,
        "can_edit_personal": True,
        "can_edit_name": False,
    }
    assert data["personal"]["phone"] == "555-0100" and data["personal"]["dob"] == "1990-01-02"
    assert data["address"]["current_country"] == "India"
    assert data["emergency_contacts"] == []


def test_me_and_the_own_id_are_the_same_profile():
    client, me = _as("Employee")

    assert client.get(_url(me.pk)).json()["data"]["id"] == client.get(_url()).json()["data"]["id"]


def test_the_job_section_carries_resolved_names_so_the_page_needs_no_lookups():
    boss_user = UserFactory(first_name="Bo", last_name="Boss")
    boss = EmployeeFactory(user=boss_user)
    client, _ = _as("Employee", manager=boss)

    job = client.get(_url()).json()["data"]["job"]

    assert job["manager"] == {"id": str(boss.pk), "name": "Bo Boss"}
    assert {"department_name", "designation_name", "location_name", "date_of_joining"} <= set(job)


def test_hr_reads_anyones_full_profile_and_may_edit_it():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory(phone="555-0111")

    data = hr.get(_url(person.pk)).json()["data"]

    assert data["personal"]["phone"] == "555-0111"
    assert data["access"]["is_self"] is False
    assert data["access"]["can_edit_personal"] and data["access"]["can_edit_name"]


def test_a_manager_sees_a_reports_job_but_no_personal_data():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager, phone="555-0122")

    response = manager_client.get(_url(report.pk))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["job"]["employee_code"] == report.employee_code
    assert data["personal"] is None and data["address"] is None
    assert data["emergency_contacts"] is None
    assert data["access"]["can_read_personal"] is False
    assert data["access"]["can_edit_personal"] is False
    assert "555-0122" not in response.content.decode()


def test_an_employee_cannot_open_a_colleagues_profile():
    client, _ = _as("Employee")
    other = EmployeeFactory()

    assert client.get(_url(other.pk)).status_code == 403


def test_a_missing_employee_is_a_404_and_anonymous_is_a_401():
    client, _ = _as("HR Admin")

    assert client.get(_url(999999)).status_code == 404
    assert APIClient().get(_url()).status_code == 401


def test_an_account_without_an_employee_record_gets_a_clear_404_on_me():
    user = UserFactory(role=Role.objects.get(name="Employee"))

    assert _client_for(user).get(_url()).status_code == 404


def test_self_service_read_can_be_switched_off_for_one_person():
    """Their own directory row (job info) stays visible under employees.read;
    the personal sections, which ess.profile.read governs, disappear."""
    client, me = _as("Employee", phone="555-0100")
    UserPermissionOverrideFactory(
        user=me.user,
        permission=PermissionFactory(code="ess.profile.read"),
        scope_tier=ScopeTier.SELF,
        is_granted=False,
    )

    response = client.get(_url())

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["personal"] is None and data["address"] is None
    assert data["access"]["can_read_personal"] is False
    assert "555-0100" not in response.content.decode()


# --- legal name ---------------------------------------------------------------------------


def test_a_person_cannot_change_their_own_legal_name():
    for role in ("Employee", "HR Admin"):
        client, me = _as(role)

        response = client.patch(_url(tail="name/"), {"first_name": "Priya"}, format="json")

        assert response.status_code == 403
        me.user.refresh_from_db()
        assert me.user.first_name == "Pat"


def test_hr_rename_updates_both_user_and_employee():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory(user=UserFactory(first_name="Pat", last_name="Lee"))

    response = hr.patch(
        _url(person.pk, "name/"), {"first_name": "  Priya ", "last_name": "O'Neil-Rao"}, format="json"
    )

    assert response.status_code == 200
    person.refresh_from_db()
    person.user.refresh_from_db()
    assert (person.user.first_name, person.user.last_name) == ("Priya", "O'Neil-Rao")
    assert (person.first_name, person.last_name) == ("Priya", "O'Neil-Rao")
    assert response.json()["data"]["first_name"] == "Priya"
    entry = AuditLog.objects.get(action="Employee.name_updated")
    assert entry.diff["before"] == {"first_name": "Pat", "last_name": "Lee"}


@pytest.mark.parametrize(
    "body",
    [
        {"first_name": ""},
        {"first_name": "R2D2"},
        {"first_name": "<b>x</b>"},
        {"first_name": "A" * 61},
        {"first_name": "Ann", "last_name": "Lee 3rd"},
    ],
)
def test_invalid_names_are_refused_and_nothing_changes(body):
    hr, _ = _as("HR Admin")
    person = EmployeeFactory(user=UserFactory(first_name="Pat", last_name="Lee"))

    response = hr.patch(_url(person.pk, "name/"), body, format="json")

    assert response.status_code == 400
    person.user.refresh_from_db()
    assert person.user.first_name == "Pat"


def test_hr_can_rename_someone_but_an_employee_cannot_rename_a_colleague():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()
    employee_client, _ = _as("Employee")

    assert hr.patch(_url(person.pk, "name/"), {"first_name": "Zed"}, format="json").status_code == 200
    assert (
        employee_client.patch(
            _url(person.pk, "name/"), {"first_name": "Nope"}, format="json"
        ).status_code
        == 403
    )
    person.user.refresh_from_db()
    assert person.user.first_name == "Zed"


# --- personal fields ----------------------------------------------------------------------


def test_a_person_updates_their_own_personal_fields():
    client, me = _as("Employee")

    response = client.patch(
        _url(tail="personal/"),
        {"personal_email": "pat@home.example", "phone": "+91 98765 43210", "gender": "female"},
        format="json",
    )

    assert response.status_code == 200
    me.refresh_from_db()
    assert me.personal_email == "pat@home.example" and me.phone == "+91 98765 43210"
    entry = AuditLog.objects.get(action="Employee.profile_self_updated")
    assert entry.diff == {"fields": ["gender", "personal_email", "phone"]}
    assert "pat@home.example" not in str(entry.diff)


def test_a_person_can_clear_a_personal_field():
    client, me = _as("Employee", phone="555-0100")

    client.patch(_url(tail="personal/"), {"phone": ""}, format="json")

    me.refresh_from_db()
    assert me.phone == ""


@pytest.mark.parametrize(
    "body",
    [
        {"phone": "abc"},
        {"phone": "12"},
        {"phone": "1" * 20},
        {"personal_email": "not-an-email"},
        {"dob": "2999-01-01"},
        {"gender": "robot"},
    ],
)
def test_invalid_personal_fields_are_refused(body):
    client, me = _as("Employee")

    assert client.patch(_url(tail="personal/"), body, format="json").status_code == 400


def test_personal_endpoint_cannot_change_job_status_or_code():
    client, me = _as("Employee")
    boss = EmployeeFactory()

    client.patch(
        _url(tail="personal/"),
        {"manager_id": boss.pk, "status": "exited", "employee_code": "HACK", "phone": "5551234"},
        format="json",
    )

    me.refresh_from_db()
    assert me.manager_id is None and me.status == "active" and me.employee_code != "HACK"
    assert me.phone == "5551234"


def test_hr_edits_someone_elses_personal_fields_with_the_hr_audit_action():
    hr, _ = _as("HR Admin")
    person = EmployeeFactory()

    response = hr.patch(_url(person.pk, "personal/"), {"phone": "5559999"}, format="json")

    assert response.status_code == 200
    person.refresh_from_db()
    assert person.phone == "5559999"
    assert AuditLog.objects.filter(action="Employee.personal_updated").exists()


def test_a_manager_cannot_edit_a_reports_personal_fields():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)

    response = manager_client.patch(_url(report.pk, "personal/"), {"phone": "5550000"}, format="json")

    assert response.status_code == 403
    report.refresh_from_db()
    assert report.phone == ""


def test_self_service_write_can_be_switched_off_for_one_person():
    client, me = _as("Employee")
    UserPermissionOverrideFactory(
        user=me.user,
        permission=PermissionFactory(code="ess.profile.write"),
        scope_tier=ScopeTier.SELF,
        is_granted=False,
    )

    assert client.get(_url()).status_code == 200
    assert client.patch(_url(tail="personal/"), {"phone": "5551111"}, format="json").status_code == 403
    assert client.patch(_url(tail="name/"), {"first_name": "X"}, format="json").status_code == 403
    assert client.get(_url()).json()["data"]["access"]["can_edit_personal"] is False


# --- address ------------------------------------------------------------------------------


def test_a_person_saves_their_address_and_permanent_same_as_current_clears_the_copy():
    client, me = _as("Employee")

    response = client.put(
        _url(tail="address/"),
        {
            "current_line1": "221B Jubilee Hills",
            "current_city": "Hyderabad",
            "current_state": "Telangana",
            "current_postal_code": "500033",
            "permanent_same_as_current": True,
            "permanent_line1": "stale",
        },
        format="json",
    )

    assert response.status_code == 200
    address = EmployeeAddress.objects.get(employee=me)
    assert address.current_city == "Hyderabad" and address.permanent_line1 == ""
    body = response.json()["data"]["address"]
    assert body["permanent_same_as_current"] is True
    assert AuditLog.objects.filter(action="Employee.address_updated").exists()


def test_a_separate_permanent_address_is_kept_and_a_second_save_updates_the_same_row():
    client, me = _as("Employee")

    client.put(
        _url(tail="address/"),
        {"permanent_same_as_current": False, "permanent_line1": "Village Rd", "permanent_city": "Guntur"},
        format="json",
    )
    client.patch(_url(tail="address/"), {"current_city": "Pune"}, format="json")

    assert EmployeeAddress.objects.filter(employee=me).count() == 1
    address = EmployeeAddress.objects.get(employee=me)
    assert address.permanent_city == "Guntur" and address.current_city == "Pune"


def test_a_bad_postal_code_is_refused():
    client, _ = _as("Employee")

    response = client.put(_url(tail="address/"), {"current_postal_code": "!!"}, format="json")

    assert response.status_code == 400


def test_address_access_follows_the_personal_rules():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)
    hr, _ = _as("HR Admin")

    assert manager_client.put(_url(report.pk, "address/"), {"current_city": "X"}, format="json").status_code == 403
    assert hr.put(_url(report.pk, "address/"), {"current_city": "Y"}, format="json").status_code == 200


# --- emergency contacts -------------------------------------------------------------------


def test_a_person_adds_edits_and_removes_an_emergency_contact():
    client, me = _as("Employee")

    added = client.post(
        _url(tail="emergency-contacts/"),
        {"name": "Ravi Kumar", "relationship": "Brother", "phone": "+91 90000 11111"},
        format="json",
    )
    assert added.status_code == 201
    contact_id = added.json()["data"]["emergency_contacts"][0]["id"]

    edited = client.patch(
        _url(tail=f"emergency-contacts/{contact_id}/"), {"phone": "9000022222"}, format="json"
    )
    assert edited.status_code == 200
    assert edited.json()["data"]["emergency_contacts"][0]["phone"] == "9000022222"

    removed = client.delete(_url(tail=f"emergency-contacts/{contact_id}/"))
    assert removed.status_code == 200 and removed.json()["data"]["emergency_contacts"] == []
    assert not EmergencyContact.objects.filter(employee=me).exists()
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {
        "Employee.emergency_contact_added",
        "Employee.emergency_contact_updated",
        "Employee.emergency_contact_removed",
    } <= actions


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "relationship": "Mother", "phone": "5551234"},
        {"name": "Asha", "relationship": "", "phone": "5551234"},
        {"name": "Asha", "relationship": "Mother", "phone": ""},
        {"name": "Asha", "relationship": "Mother", "phone": "call me"},
    ],
)
def test_incomplete_or_invalid_emergency_contacts_are_refused(body):
    client, me = _as("Employee")

    assert client.post(_url(tail="emergency-contacts/"), body, format="json").status_code == 400
    assert not EmergencyContact.objects.filter(employee=me).exists()


def test_emergency_contacts_are_capped():
    client, me = _as("Employee")
    for i in range(MAX_EMERGENCY_CONTACTS):
        EmergencyContact.objects.create(employee=me, name=f"C{i}", relationship="Friend", phone="5551234")

    response = client.post(
        _url(tail="emergency-contacts/"),
        {"name": "One more", "relationship": "Friend", "phone": "5551234"},
        format="json",
    )

    assert response.status_code == 400
    assert EmergencyContact.objects.filter(employee=me).count() == MAX_EMERGENCY_CONTACTS


def test_someone_elses_contact_cannot_be_reached_through_my_profile():
    client, me = _as("Employee")
    other = EmployeeFactory()
    theirs = EmergencyContact.objects.create(
        employee=other, name="Theirs", relationship="Friend", phone="5551234"
    )

    patch = client.patch(_url(tail=f"emergency-contacts/{theirs.pk}/"), {"name": "Hacked"}, format="json")
    delete = client.delete(_url(tail=f"emergency-contacts/{theirs.pk}/"))

    assert patch.status_code == 404 and delete.status_code == 404
    theirs.refresh_from_db()
    assert theirs.name == "Theirs"


def test_a_manager_cannot_add_a_contact_for_a_report():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)

    response = manager_client.post(
        _url(report.pk, "emergency-contacts/"),
        {"name": "A", "relationship": "B", "phone": "5551234"},
        format="json",
    )

    assert response.status_code == 403
