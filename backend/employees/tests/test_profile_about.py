"""Employee 360 About card and skills: `/employees/<id|me>/profile/about|skills/`."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from employees.models import EmployeeAbout, EmployeeSkill
from employees.profile_serializers import ABOUT_MAX_LENGTH, MAX_SKILLS

pytestmark = pytest.mark.django_db


def _as(role_name, **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name), first_name="Pat", last_name="Lee")
    employee = EmployeeFactory(user=user, **employee_kwargs)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, employee


def _url(target="me", tail=""):
    return f"/api/v1/employees/{target}/profile/{tail}"


# --- About ----------------------------------------------------------------------------------


def test_a_new_profile_has_empty_answers_and_no_skills():
    client, _ = _as("Employee")

    data = client.get(_url()).json()["data"]

    assert data["about"] == {"about": "", "love_about_job": "", "interests": ""}
    assert data["skills"] == []


def test_a_person_saves_and_clears_their_answers():
    client, me = _as("Employee")

    saved = client.patch(
        _url(tail="about/"),
        {"about": "  I run HR ops.  ", "love_about_job": "The people", "interests": "Chess"},
        format="json",
    )

    assert saved.status_code == 200
    assert saved.json()["data"]["about"] == {
        "about": "I run HR ops.",
        "love_about_job": "The people",
        "interests": "Chess",
    }
    entry = AuditLog.objects.get(action="Employee.about_updated")
    assert entry.diff == {"fields": ["about", "interests", "love_about_job"]}
    assert "Chess" not in str(entry.diff)

    client.patch(_url(tail="about/"), {"interests": ""}, format="json")
    row = EmployeeAbout.objects.get(employee=me)
    assert row.interests == "" and row.about == "I run HR ops."
    assert EmployeeAbout.objects.filter(employee=me).count() == 1


@pytest.mark.parametrize(
    "body",
    [
        {"about": "x" * (ABOUT_MAX_LENGTH + 1)},
        {"interests": "bad" + chr(0) + "byte"},
    ],
)
def test_too_long_or_control_character_answers_are_refused(body):
    client, me = _as("Employee")

    assert client.patch(_url(tail="about/"), body, format="json").status_code == 400
    assert not EmployeeAbout.objects.filter(employee=me).exists()


def test_the_answers_are_visible_to_a_manager_but_only_the_person_and_hr_can_edit():
    manager_client, manager = _as("Manager")
    report_client, report = _as("Employee", manager=manager)
    hr, _ = _as("HR Admin")
    report_client.patch(_url(tail="about/"), {"about": "Hello"}, format="json")

    seen = manager_client.get(_url(report.pk)).json()["data"]
    manager_edit = manager_client.patch(_url(report.pk, "about/"), {"about": "Hacked"}, format="json")
    hr_edit = hr.patch(_url(report.pk, "about/"), {"interests": "Reading"}, format="json")

    assert seen["about"]["about"] == "Hello"
    assert manager_edit.status_code == 403
    assert hr_edit.status_code == 200
    assert EmployeeAbout.objects.get(employee=report).about == "Hello"


def test_an_employee_cannot_edit_a_colleagues_answers():
    client, _ = _as("Employee")
    other = EmployeeFactory()

    assert client.patch(_url(other.pk, "about/"), {"about": "x"}, format="json").status_code == 403


# --- Skills ---------------------------------------------------------------------------------


def test_a_person_adds_and_removes_skills():
    client, me = _as("Employee")

    first = client.post(_url(tail="skills/"), {"name": "  Recruiting   Ops "}, format="json")
    client.post(_url(tail="skills/"), {"name": "Payroll"}, format="json")

    assert first.status_code == 201
    skills = first.json()["data"]["skills"]
    assert [s["name"] for s in skills] == ["Recruiting Ops"]

    removed = client.delete(_url(tail=f"skills/{skills[0]['id']}/"))
    assert removed.status_code == 200
    assert [s["name"] for s in removed.json()["data"]["skills"]] == ["Payroll"]
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"Employee.skill_added", "Employee.skill_removed"} <= actions
    assert EmployeeSkill.objects.filter(employee=me).count() == 1


@pytest.mark.parametrize("name", ["", "   ", "x" * 61, "bad" + chr(7) + "bell"])
def test_invalid_skill_names_are_refused(name):
    client, me = _as("Employee")

    assert client.post(_url(tail="skills/"), {"name": name}, format="json").status_code == 400
    assert not EmployeeSkill.objects.filter(employee=me).exists()


def test_a_duplicate_skill_is_refused_ignoring_case():
    client, me = _as("Employee")
    client.post(_url(tail="skills/"), {"name": "Python"}, format="json")

    response = client.post(_url(tail="skills/"), {"name": "python"}, format="json")

    assert response.status_code == 400
    assert EmployeeSkill.objects.filter(employee=me).count() == 1


def test_two_people_can_list_the_same_skill():
    client, _ = _as("Employee")
    other_client, _ = _as("Employee")

    assert client.post(_url(tail="skills/"), {"name": "SQL"}, format="json").status_code == 201
    assert other_client.post(_url(tail="skills/"), {"name": "SQL"}, format="json").status_code == 201


def test_skills_are_capped():
    client, me = _as("Employee")
    for i in range(MAX_SKILLS):
        EmployeeSkill.objects.create(employee=me, name=f"Skill {i}")

    response = client.post(_url(tail="skills/"), {"name": "One more"}, format="json")

    assert response.status_code == 400
    assert EmployeeSkill.objects.filter(employee=me).count() == MAX_SKILLS


def test_someone_elses_skill_cannot_be_removed_through_my_profile():
    client, _ = _as("Employee")
    other = EmployeeFactory()
    theirs = EmployeeSkill.objects.create(employee=other, name="Theirs")

    assert client.delete(_url(tail=f"skills/{theirs.pk}/")).status_code == 404
    assert EmployeeSkill.objects.filter(pk=theirs.pk).exists()


def test_a_manager_cannot_add_a_skill_for_a_report_but_hr_can():
    manager_client, manager = _as("Manager")
    report = EmployeeFactory(manager=manager)
    hr, _ = _as("HR Admin")

    assert manager_client.post(_url(report.pk, "skills/"), {"name": "X"}, format="json").status_code == 403
    assert hr.post(_url(report.pk, "skills/"), {"name": "X"}, format="json").status_code == 201
