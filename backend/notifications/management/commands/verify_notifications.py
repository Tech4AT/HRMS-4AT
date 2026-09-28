"""`manage.py verify_notifications` — live proof the notifications primitive
honours self-scoping and the read paths, over real HTTP with real logins."""

from accounts.models import User
from core.verification import VerificationCommand, Verifier
from notifications.service import notify

PASSWORD = "Verify@12345"


class Command(VerificationCommand):
    title = "Notifications primitive"

    def verify(self, v: Verifier):
        alice = User.objects.create_user(
            username="alice@x.com", email="alice@x.com", password=PASSWORD
        )
        bob = User.objects.create_user(username="bob@x.com", email="bob@x.com", password=PASSWORD)

        notify(alice, "leave.approved", "Leave approved", "Your leave was approved.")
        notify(alice, "system", "Welcome")
        bobs = notify(bob, "system", "Bob only")

        v.note("--- a user sees only their own notifications")
        session = v.login("alice", "alice@x.com", PASSWORD)
        res = session.get("/api/v1/notifications")
        v.check("list returns 200", res.status_code == 200, f"HTTP {res.status_code}")
        data = res.json()["data"]
        v.check(
            "unread count is correct (2)", data["unreadCount"] == 2, f"got {data['unreadCount']}"
        )
        v.check("only the caller's rows are returned", len(data["notifications"]) == 2)
        v.check(
            "no colleague's notification leaks",
            all(n["userId"] == str(alice.id) for n in data["notifications"]),
        )
        first = data["notifications"][0]
        v.check("rows expose readAt + createdAt", first["readAt"] is None and "createdAt" in first)

        v.note("--- marking read")
        session.put(f"/api/v1/notifications/{first['id']}/read", {})
        after = session.get("/api/v1/notifications").json()["data"]
        v.check("marking one read drops the unread count to 1", after["unreadCount"] == 1)
        marked = session.put("/api/v1/notifications/read-all", {}).json()["data"]["markedCount"]
        v.check("read-all marks the rest (1)", marked == 1, f"got {marked}")
        v.check(
            "unread count is 0 after read-all",
            session.get("/api/v1/notifications").json()["data"]["unreadCount"] == 0,
        )

        v.note("--- a user cannot touch another's notification")
        r = session.put(f"/api/v1/notifications/{bobs.id}/read", {})
        v.check(
            "marking a colleague's notification is a 404",
            r.status_code == 404,
            f"HTTP {r.status_code}",
        )

        v.note("--- anonymous is refused")
        anon = v.session("anon").get("/api/v1/notifications")
        v.check("anonymous list is 401", anon.status_code == 401, f"HTTP {anon.status_code}")
