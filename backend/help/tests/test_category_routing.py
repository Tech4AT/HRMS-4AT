"""Category routing: a category can have several owners. Each owner works that
category's tickets and is notified; new tickets are auto-assigned to the least
busy owner."""

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from help.models import CategoryAssignment, Ticket, TicketStatus
from help.views import MAX_OWNERS_PER_CATEGORY
from notifications.models import Notification

pytestmark = pytest.mark.django_db

ROUTING = "/api/v1/help/category-assignments"
TICKETS = "/api/v1/help/tickets"
IT, HR, FOOD = "IT & Access", "HR", "Food"


def _person(role_name="Employee", **employee_kwargs):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user, **employee_kwargs)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user, employee


def _set_owners(hr_client, category, *employees):
    response = hr_client.put(
        ROUTING, {"category": category, "assignee_ids": [str(e.pk) for e in employees]}, format="json"
    )
    assert response.status_code == 200, response.content
    return response


def _raise_ticket(client, category=IT, subject="Something broke"):
    response = client.post(
        TICKETS,
        {"subject": subject, "description": "Please take a look", "category": category, "priority": "Medium"},
        format="json",
    )
    assert response.status_code == 201, response.content
    return response.json()["data"]


def _row(hr_client, category):
    rows = hr_client.get(ROUTING).json()["data"]
    return next(r for r in rows if r["category"] == category)


def _owner_ids(hr_client, category):
    return [a["id"] for a in _row(hr_client, category)["assignees"]]


# --- the routing table ---------------------------------------------------------------------


def test_every_category_is_listed_with_no_owners_by_default():
    hr, _, _ = _person("HR Admin")

    rows = hr.get(ROUTING).json()["data"]

    assert [r["category"] for r in rows] == [IT, "Facilities", FOOD, "Cab", "Finance & Admin", HR, "Others"]
    assert all(r["assignees"] == [] for r in rows)


def test_a_category_can_have_several_owners_in_the_order_they_were_added():
    hr, _, _ = _person("HR Admin")
    a, b, c = EmployeeFactory(), EmployeeFactory(), EmployeeFactory()

    response = _set_owners(hr, IT, a, b, c)

    assert [o["id"] for o in response.json()["data"]["assignees"]] == [str(a.pk), str(b.pk), str(c.pk)]
    assert _owner_ids(hr, IT) == [str(a.pk), str(b.pk), str(c.pk)]
    assert all(o["name"] for o in _row(hr, IT)["assignees"])


def test_setting_owners_replaces_the_set_and_keeps_those_who_stay():
    hr, _, _ = _person("HR Admin")
    a, b, c = EmployeeFactory(), EmployeeFactory(), EmployeeFactory()
    _set_owners(hr, IT, a, b)
    kept_row = CategoryAssignment.objects.get(category=IT, assignee=b)

    _set_owners(hr, IT, b, c)

    assert _owner_ids(hr, IT) == [str(b.pk), str(c.pk)]
    assert CategoryAssignment.objects.get(category=IT, assignee=b).pk == kept_row.pk
    entry = AuditLog.objects.filter(action="CategoryAssignment.set").latest("created_at")
    assert entry.diff == {"assignees": [b.pk, c.pk], "added": [c.pk], "removed": [a.pk]}


def test_owners_are_per_category():
    hr, _, _ = _person("HR Admin")
    a, b = EmployeeFactory(), EmployeeFactory()
    _set_owners(hr, IT, a)
    _set_owners(hr, FOOD, a, b)

    assert _owner_ids(hr, IT) == [str(a.pk)] and _owner_ids(hr, FOOD) == [str(a.pk), str(b.pk)]


def test_an_empty_list_clears_the_category_and_repeats_are_harmless():
    hr, _, _ = _person("HR Admin")
    a = EmployeeFactory()
    _set_owners(hr, IT, a)

    _set_owners(hr, IT)
    _set_owners(hr, IT)

    assert _owner_ids(hr, IT) == []
    assert AuditLog.objects.filter(action="CategoryAssignment.cleared").count() == 1


def test_duplicate_ids_are_collapsed():
    hr, _, _ = _person("HR Admin")
    a = EmployeeFactory()

    hr.put(ROUTING, {"category": IT, "assignee_ids": [str(a.pk), a.pk, str(a.pk)]}, format="json")

    assert _owner_ids(hr, IT) == [str(a.pk)]


def test_the_single_owner_form_still_works():
    hr, _, _ = _person("HR Admin")
    a = EmployeeFactory()

    hr.put(ROUTING, {"category": IT, "assignee_id": str(a.pk)}, format="json")
    assert _owner_ids(hr, IT) == [str(a.pk)]

    hr.put(ROUTING, {"category": IT, "assignee_id": None}, format="json")
    assert _owner_ids(hr, IT) == []


@pytest.mark.parametrize(
    "body",
    [
        {"category": "Nonsense", "assignee_ids": []},
        {"category": IT, "assignee_ids": "3"},
        {"category": IT, "assignee_ids": ["abc"]},
        {"category": IT, "assignee_ids": [True]},
        {"category": IT, "assignee_ids": ["999999"]},
        {},
    ],
)
def test_bad_requests_are_refused_and_change_nothing(body):
    hr, _, _ = _person("HR Admin")
    existing = EmployeeFactory()
    _set_owners(hr, IT, existing)

    assert hr.put(ROUTING, body, format="json").status_code == 400
    assert _owner_ids(hr, IT) == [str(existing.pk)]


def test_an_exited_employee_cannot_be_made_an_owner():
    hr, _, _ = _person("HR Admin")
    gone = EmployeeFactory(status="exited")

    response = hr.put(ROUTING, {"category": IT, "assignee_ids": [str(gone.pk)]}, format="json")

    assert response.status_code == 400 and _owner_ids(hr, IT) == []


def test_one_bad_id_in_a_list_saves_none_of_it():
    hr, _, _ = _person("HR Admin")
    good = EmployeeFactory()

    response = hr.put(ROUTING, {"category": IT, "assignee_ids": [str(good.pk), "999999"]}, format="json")

    assert response.status_code == 400 and _owner_ids(hr, IT) == []


def test_there_is_a_limit_on_owners_per_category():
    hr, _, _ = _person("HR Admin")
    people = EmployeeFactory.create_batch(MAX_OWNERS_PER_CATEGORY + 1)

    assert hr.put(ROUTING, {"category": IT, "assignee_ids": [str(p.pk) for p in people]}, format="json").status_code == 400
    assert _set_owners(hr, IT, *people[:MAX_OWNERS_PER_CATEGORY]).status_code == 200


def test_the_same_person_cannot_be_listed_twice_for_one_category_at_the_database_level():
    a = EmployeeFactory()
    CategoryAssignment.objects.create(category=IT, assignee=a)

    with pytest.raises(IntegrityError), transaction.atomic():
        CategoryAssignment.objects.create(category=IT, assignee=a)


def test_only_help_managers_can_read_or_change_routing():
    owner_client, _, owner = _person()
    employee_client, _, _ = _person()
    hr, _, _ = _person("HR Admin")
    _set_owners(hr, IT, owner)

    for client in (employee_client, owner_client):
        assert client.get(ROUTING).status_code == 403
        assert client.put(ROUTING, {"category": IT, "assignee_ids": []}, format="json").status_code == 403
    assert APIClient().get(ROUTING).status_code == 401
    assert _owner_ids(hr, IT) == [str(owner.pk)]


# --- auto-assigning new tickets ------------------------------------------------------------


def test_a_single_owner_gets_every_new_ticket_as_before():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, _, owner = _person()
    _set_owners(hr, IT, owner)

    assigned = [_raise_ticket(requester)["assigned_to_id"] for _ in range(3)]

    assert assigned == [str(owner.pk)] * 3


def test_with_several_owners_new_tickets_go_to_the_least_busy_one():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, _, first = _person()
    _, _, second = _person()
    _set_owners(hr, IT, first, second)

    assigned = [_raise_ticket(requester)["assigned_to_id"] for _ in range(4)]

    # A tie goes to the longest-standing owner, then the load evens out.
    assert assigned == [str(first.pk), str(second.pk), str(first.pk), str(second.pk)]


def test_resolved_and_closed_tickets_do_not_count_as_load():
    hr, _, _ = _person("HR Admin")
    requester, _, requester_employee = _person()
    _, _, first = _person()
    _, _, second = _person()
    _set_owners(hr, IT, first, second)
    for status in (TicketStatus.RESOLVED, TicketStatus.CLOSED):
        Ticket.objects.create(
            employee=requester_employee, assigned_to=first, subject="old", description="old",
            category=IT, status=status,
        )
    Ticket.objects.create(
        employee=requester_employee, assigned_to=second, subject="open", description="open",
        category=IT, status=TicketStatus.IN_PROGRESS,
    )

    assert _raise_ticket(requester)["assigned_to_id"] == str(first.pk)


def test_a_category_with_no_owners_leaves_the_ticket_unassigned():
    requester, _, _ = _person()

    assert _raise_ticket(requester, category=FOOD)["assigned_to_id"] is None


def test_changing_a_ticket_to_a_category_its_assignee_also_owns_keeps_them():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, _, a = _person()
    _, _, b = _person()
    _set_owners(hr, IT, a)
    _set_owners(hr, HR, b, a)
    ticket = _raise_ticket(requester, category=IT)

    response = requester.patch(f"{TICKETS}/{ticket['id']}", {"category": HR}, format="json")

    assert response.json()["data"]["assigned_to_id"] == str(a.pk)  # not shuffled to b


def test_changing_a_ticket_to_a_category_owned_by_someone_else_re_routes_it():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, _, a = _person()
    _, _, c = _person()
    _set_owners(hr, IT, a)
    _set_owners(hr, FOOD, c)
    ticket = _raise_ticket(requester, category=IT)

    response = requester.patch(f"{TICKETS}/{ticket['id']}", {"category": FOOD}, format="json")

    assert response.json()["data"]["assigned_to_id"] == str(c.pk)


def test_changing_a_ticket_to_a_category_with_no_owners_unassigns_it():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, _, a = _person()
    _set_owners(hr, IT, a)
    ticket = _raise_ticket(requester, category=IT)

    response = requester.patch(f"{TICKETS}/{ticket['id']}", {"category": FOOD}, format="json")

    assert response.json()["data"]["assigned_to_id"] is None


# --- every owner works the category ---------------------------------------------------------


def test_every_owner_can_see_and_work_the_categorys_tickets_but_not_others():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    a_client, _, a = _person()
    b_client, _, b = _person()
    outsider_client, _, _ = _person()
    _set_owners(hr, IT, a, b)
    it_ticket = _raise_ticket(requester, category=IT)
    food_ticket = _raise_ticket(requester, category=FOOD)

    for client in (a_client, b_client):
        queue = client.get(f"{TICKETS}/queue").json()["data"]
        assert {t["id"] for t in queue} == {it_ticket["id"]}
        moved = client.patch(f"{TICKETS}/{it_ticket['id']}/status", {"status": "In progress"}, format="json")
        assert moved.status_code == 200
        assert client.patch(f"{TICKETS}/{food_ticket['id']}/status", {"status": "In progress"}, format="json").status_code == 403
    assert outsider_client.get(f"{TICKETS}/queue").status_code == 403


def test_an_owner_of_several_categories_sees_them_all_in_their_rail():
    hr, _, _ = _person("HR Admin")
    a_client, _, a = _person()
    _set_owners(hr, IT, a)
    _set_owners(hr, FOOD, a)

    data = a_client.get("/api/v1/help/my-categories").json()["data"]

    assert data["can_manage"] is False and set(data["categories"]) == {IT, FOOD}


def _next_request_as(user):
    """A client for `user`'s next request. In production every request loads the
    user afresh; `force_authenticate` would otherwise keep one instance, and with
    it the per-request cache of the categories they own."""
    client = APIClient()
    client.force_authenticate(user=type(user).objects.get(pk=user.pk))
    return client


def test_a_removed_owner_loses_access_to_the_queue():
    hr, _, _ = _person("HR Admin")
    _, a_user, a = _person()
    _, b_user, b = _person()
    _set_owners(hr, IT, a, b)
    assert _next_request_as(a_user).get(f"{TICKETS}/queue").status_code == 200

    _set_owners(hr, IT, b)

    assert _next_request_as(a_user).get(f"{TICKETS}/queue").status_code == 403
    assert _next_request_as(b_user).get(f"{TICKETS}/queue").status_code == 200


# --- notifications --------------------------------------------------------------------------


def test_every_owner_is_notified_of_a_new_ticket():
    hr, _, _ = _person("HR Admin")
    requester, _, _ = _person()
    _, a_user, a = _person()
    _, b_user, b = _person()
    _, outsider_user, _ = _person()
    _set_owners(hr, IT, a, b)

    _raise_ticket(requester, category=IT, subject="VPN is down")

    for user in (a_user, b_user):
        assert Notification.objects.filter(user=user, title="New ticket: VPN is down").count() == 1
    assert not Notification.objects.filter(user=outsider_user).exists()


def test_someone_who_is_both_an_owner_and_a_help_manager_is_notified_once():
    hr_client, hr_user, hr_employee = _person("HR Admin")
    requester, _, _ = _person()
    _set_owners(hr_client, IT, hr_employee)

    _raise_ticket(requester, category=IT, subject="Printer")

    assert Notification.objects.filter(user=hr_user, title="New ticket: Printer").count() == 1
