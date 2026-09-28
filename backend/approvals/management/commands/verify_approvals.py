"""`manage.py verify_approvals` — live proof of the approval lifecycle over real
HTTP: manager-derived approver, approve/reject/withdraw, terminal states, the
approver-only rule, and the HR reassign / force-resolve escape hatches."""

from accounts.models import Permission, User, UserPermissionOverride
from core.verification import VerificationCommand, Verifier
from employees.models import Employee

PASSWORD = "Verify@12345"


def _user(email):
    return User.objects.create_user(username=email, email=email, password=PASSWORD)


def _grant_manage(user):
    UserPermissionOverride.objects.create(
        user=user,
        permission=Permission.objects.get(code="approvals.manage"),
        scope_tier="all",
        is_granted=True,
    )


class Command(VerificationCommand):
    title = "Approvals primitive"

    def verify(self, v: Verifier):
        manager_user = _user("mgr@x.com")
        mgr = Employee.objects.create(user=manager_user, employee_code="M1")
        requester_user = _user("req@x.com")
        Employee.objects.create(user=requester_user, employee_code="R1", manager=mgr)
        hr_user = _user("hr@x.com")
        Employee.objects.create(user=hr_user, employee_code="H1")
        _grant_manage(hr_user)

        req = v.login("requester", "req@x.com", PASSWORD)
        mgrs = v.login("manager", "mgr@x.com", PASSWORD)
        hr = v.login("hr", "hr@x.com", PASSWORD)

        v.note("--- a request routes to the requester's manager")
        created = req.post("/api/v1/requests/", {"request_type": "leave", "payload": {"days": 2}})
        v.check("create returns 201", created.status_code == 201, f"HTTP {created.status_code}")
        data = created.json()["data"]
        v.check("approver is the manager", data["approver"] == str(manager_user.id))
        rid = data["id"]

        v.note("--- only the assigned approver may decide")
        self_decide = req.post(f"/api/v1/requests/{rid}/approve/", {})
        v.check("requester cannot approve own request (403)", self_decide.status_code == 403)

        v.note("--- the manager approves; the state is then terminal")
        ok = mgrs.post(f"/api/v1/requests/{rid}/approve/", {"note": "fine"})
        v.check("manager approve is 200", ok.status_code == 200, f"HTTP {ok.status_code}")
        v.check("status becomes approved", ok.json()["data"]["status"] == "approved")
        again = mgrs.post(f"/api/v1/requests/{rid}/approve/", {})
        v.check("re-deciding a resolved request is 400", again.status_code == 400)

        v.note("--- the requester can withdraw a pending request")
        r2 = req.post("/api/v1/requests/", {"request_type": "leave", "payload": {}}).json()["data"]
        wd = req.post(f"/api/v1/requests/{r2['id']}/withdraw/", {})
        v.check("withdraw is 200", wd.status_code == 200, f"HTTP {wd.status_code}")
        v.check("status becomes withdrawn", wd.json()["data"]["status"] == "withdrawn")

        v.note("--- HR can force-resolve, bypassing the approver")
        r3 = req.post("/api/v1/requests/", {"request_type": "leave", "payload": {}}).json()["data"]
        forced = hr.post(
            f"/api/v1/requests/{r3['id']}/resolve/", {"status": "rejected", "note": "policy"}
        )
        v.check("HR force-resolve is 200", forced.status_code == 200, f"HTTP {forced.status_code}")
        v.check("forced status is applied", forced.json()["data"]["status"] == "rejected")

        v.note("--- an unassigned request (no manager) can be reassigned by HR")
        orphan_user = _user("orphan@x.com")
        Employee.objects.create(user=orphan_user, employee_code="O1")  # no manager
        orphan = v.login("orphan", "orphan@x.com", PASSWORD)
        r4 = orphan.post("/api/v1/requests/", {"request_type": "leave", "payload": {}}).json()[
            "data"
        ]
        v.check("no manager → approver is null", r4["approver"] is None)
        moved = hr.post(
            f"/api/v1/requests/{r4['id']}/reassign/", {"approver": str(manager_user.id)}
        )
        v.check("HR reassign is 200", moved.status_code == 200, f"HTTP {moved.status_code}")
        v.check("approver is now set", moved.json()["data"]["approver"] == str(manager_user.id))
        denied = req.post(f"/api/v1/requests/{r4['id']}/reassign/", {"approver": str(hr_user.id)})
        v.check("a non-manager cannot reassign (403)", denied.status_code == 403)

        v.note("--- anonymous is refused")
        anon = v.session("anon").get("/api/v1/requests/")
        v.check("anonymous list is 401", anon.status_code == 401, f"HTTP {anon.status_code}")
