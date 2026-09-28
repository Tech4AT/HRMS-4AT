"""Conformance for the notifications primitive: self-scoping (you only see and
mutate your own), unread counting, and the mark-read paths."""

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from notifications.service import notify


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


@pytest.mark.django_db
def test_notifications_are_self_scoped_and_countable():
    alice, bob = _user("alice@x.com"), _user("bob@x.com")
    notify(alice, "leave.approved", "Leave approved", "Your leave was approved.")
    notify(alice, "system", "Welcome")
    notify(bob, "system", "Bob only")

    client = APIClient()
    client.force_authenticate(alice)

    body = client.get("/api/v1/notifications").json()["data"]
    assert body["unreadCount"] == 2
    assert len(body["notifications"]) == 2
    # Never a colleague's notification.
    assert all(n["userId"] == str(alice.id) for n in body["notifications"])
    first = body["notifications"][0]
    assert first["readAt"] is None and "createdAt" in first

    # Mark one read → unread drops.
    client.put(f"/api/v1/notifications/{first['id']}/read")
    assert client.get("/api/v1/notifications").json()["data"]["unreadCount"] == 1

    # Mark all read.
    marked = client.put("/api/v1/notifications/read-all").json()["data"]["markedCount"]
    assert marked == 1
    assert client.get("/api/v1/notifications").json()["data"]["unreadCount"] == 0


@pytest.mark.django_db
def test_cannot_mark_another_users_notification():
    alice, bob = _user("a@x.com"), _user("b@x.com")
    bobs = notify(bob, "system", "Bob only")

    client = APIClient()
    client.force_authenticate(alice)
    # Alice trying to read Bob's notification → 404 (never leaked as 200).
    assert client.put(f"/api/v1/notifications/{bobs.id}/read").status_code == 404


@pytest.mark.django_db
def test_anonymous_is_rejected():
    assert APIClient().get("/api/v1/notifications").status_code == 401
