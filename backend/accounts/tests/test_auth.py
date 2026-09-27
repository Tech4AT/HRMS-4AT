"""Auth endpoints against the real contract (docs/IMPLEMENTATION-PLAN.md,
cross-checked against the actual frontend proxy code — see accounts/auth_views.py's
docstring for where the two had drifted)."""

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from accounts.factories import RoleFactory, UserFactory
from accounts.models import FailedLoginAttempt
from audit.models import AuditLog
from core.enums import RoleArchetype, ScopeTier
from core.scope import baseline_self_permissions
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db

PASSWORD = "correct horse battery staple"


def _user_with_password(**kwargs):
    user = UserFactory(**kwargs)
    user.set_password(PASSWORD)
    user.save(update_fields=["password"])
    return user


def test_login_success_returns_user_and_tokens():
    user = _user_with_password(email="a@example.com")
    client = APIClient()

    resp = client.post("/api/v1/auth/login", {"email": "a@example.com", "password": PASSWORD})

    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["user"]["id"] == str(user.pk)
    assert body["user"]["email"] == "a@example.com"
    assert "accessToken" in body and "refreshToken" in body


def test_login_wrong_password_is_401_with_contract_error_shape():
    _user_with_password(email="a@example.com")
    client = APIClient()

    resp = client.post("/api/v1/auth/login", {"email": "a@example.com", "password": "nope"})

    assert resp.status_code == 401
    body = resp.json()
    assert body["success"] is False
    assert body["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_email_is_401_not_500():
    client = APIClient()

    resp = client.post("/api/v1/auth/login", {"email": "nobody@example.com", "password": "x"})

    assert resp.status_code == 401


def test_refresh_rotates_and_old_token_is_rejected():
    _user_with_password(email="a@example.com")
    client = APIClient()
    login_resp = client.post("/api/v1/auth/login", {"email": "a@example.com", "password": PASSWORD})
    original_refresh = login_resp.json()["data"]["refreshToken"]

    first = client.post("/api/v1/auth/refresh", {"refreshToken": original_refresh})
    assert first.status_code == 200
    assert first.json()["data"]["refreshToken"] != original_refresh

    replay = client.post("/api/v1/auth/refresh", {"refreshToken": original_refresh})
    assert replay.status_code == 401


def test_logout_blacklists_the_refresh_token():
    _user_with_password(email="a@example.com")
    client = APIClient()
    login_resp = client.post("/api/v1/auth/login", {"email": "a@example.com", "password": PASSWORD})
    refresh_token = login_resp.json()["data"]["refreshToken"]

    logout_resp = client.post("/api/v1/auth/logout", {"refreshToken": refresh_token})
    assert logout_resp.status_code == 200

    after = client.post("/api/v1/auth/refresh", {"refreshToken": refresh_token})
    assert after.status_code == 401


def test_me_requires_auth():
    client = APIClient()
    resp = client.get("/api/v1/users/me")
    assert resp.status_code == 401


def test_me_matches_contract_shape_for_org_scope_role():
    # Named differently from the real seeded "HR Admin" (see
    # employees/tests/test_views.py's starter_roles fixture for why).
    role = RoleFactory(name="Test HR Admin", archetype=RoleArchetype.SUPERADMIN)
    from accounts.factories import PermissionFactory, RolePermissionFactory

    permission = PermissionFactory(code="employees.read")
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/api/v1/users/me")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["roles"] == ["Test HR Admin"]
    assert data["archetype"] == "superadmin"
    assert "employees.read" in data["permissions"]
    assert data["scope"] == {"kind": "org"}


def test_me_scope_is_team_with_employee_ids_for_manager_tier():
    from accounts.factories import PermissionFactory, RolePermissionFactory

    role = RoleFactory(archetype=RoleArchetype.EMPLOYEE)
    permission = PermissionFactory(code="employees.read")
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.MANAGER)
    user = UserFactory(role=role)
    manager = EmployeeFactory(user=user)
    report = EmployeeFactory(manager=manager)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/api/v1/users/me")

    scope = resp.json()["data"]["scope"]
    assert scope["kind"] == "team"
    assert set(scope["employeeIds"]) == {str(manager.pk), str(report.pk)}


def test_me_scope_is_self_with_no_role():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/api/v1/users/me")

    assert resp.json()["data"]["scope"] == {"kind": "self"}
    # Role-less but still an employee: holds exactly the self-service baseline.
    assert set(resp.json()["data"]["permissions"]) == baseline_self_permissions()


def test_me_patch_updates_name_only():
    user = UserFactory(first_name="Old", last_name="Name")
    EmployeeFactory(user=user)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.patch(
        "/api/v1/users/me", {"firstName": "New", "lastName": "Name2"}, format="json"
    )

    assert resp.status_code == 200
    assert resp.json()["data"]["firstName"] == "New"
    assert resp.json()["data"]["lastName"] == "Name2"


# --- P1-E4-01/02: per-account lockout ---


def test_five_failed_attempts_locks_the_account():
    _user_with_password(email="lockout@example.com")
    client = APIClient()

    for _ in range(5):
        resp = client.post(
            "/api/v1/auth/login", {"email": "lockout@example.com", "password": "wrong"}
        )
        assert resp.status_code == 401

    # 6th attempt, even with the CORRECT password, is locked out.
    resp = client.post("/api/v1/auth/login", {"email": "lockout@example.com", "password": PASSWORD})
    assert resp.status_code == 423
    assert resp.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_fewer_than_five_failures_does_not_lock():
    _user_with_password(email="notlocked@example.com")
    client = APIClient()

    for _ in range(4):
        client.post("/api/v1/auth/login", {"email": "notlocked@example.com", "password": "wrong"})

    resp = client.post(
        "/api/v1/auth/login", {"email": "notlocked@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200


def test_failures_outside_the_lockout_window_do_not_count():
    from datetime import timedelta

    from django.utils import timezone

    user = _user_with_password(email="stale@example.com")
    for _ in range(5):
        FailedLoginAttempt.objects.create(user=user)
    # auto_now_add sets created_at on save regardless of what's passed at
    # create() time, so backdate afterwards via a bulk update instead.
    FailedLoginAttempt.objects.filter(user=user).update(
        created_at=timezone.now() - timedelta(minutes=20)
    )

    client = APIClient()
    resp = client.post("/api/v1/auth/login", {"email": "stale@example.com", "password": PASSWORD})

    assert resp.status_code == 200


# --- audit trail on every auth event ---


def test_login_success_is_audited():
    user = _user_with_password(email="audit1@example.com")
    client = APIClient()

    client.post("/api/v1/auth/login", {"email": "audit1@example.com", "password": PASSWORD})

    log = AuditLog.objects.get(action="auth.login_succeeded")
    assert log.actor == user
    assert log.entity_id == str(user.pk)


def test_login_failure_is_audited():
    _user_with_password(email="audit2@example.com")
    client = APIClient()

    client.post("/api/v1/auth/login", {"email": "audit2@example.com", "password": "wrong"})

    log = AuditLog.objects.get(action="auth.login_failed")
    assert log.actor is None
    assert log.diff["email"] == "audit2@example.com"


def test_logout_is_audited():
    user = _user_with_password(email="audit3@example.com")
    client = APIClient()
    login_resp = client.post(
        "/api/v1/auth/login", {"email": "audit3@example.com", "password": PASSWORD}
    )
    refresh_token = login_resp.json()["data"]["refreshToken"]

    client.post("/api/v1/auth/logout", {"refreshToken": refresh_token})

    log = AuditLog.objects.get(action="auth.logout")
    assert log.actor == user


def test_token_refresh_is_audited():
    user = _user_with_password(email="audit4@example.com")
    client = APIClient()
    login_resp = client.post(
        "/api/v1/auth/login", {"email": "audit4@example.com", "password": PASSWORD}
    )
    refresh_token = login_resp.json()["data"]["refreshToken"]

    client.post("/api/v1/auth/refresh", {"refreshToken": refresh_token})

    log = AuditLog.objects.get(action="auth.token_refreshed")
    assert log.actor == user


def test_profile_update_is_audited():
    user = UserFactory(first_name="Old")
    EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)

    client.patch("/api/v1/users/me", {"firstName": "New", "lastName": "X"}, format="json")

    log = AuditLog.objects.get(action="user.profile_updated")
    assert log.actor == user
    assert log.diff["before"]["firstName"] == "Old"
    assert log.diff["after"]["firstName"] == "New"


# --- P1-E1-10: login throttle ---
# ScopedRateThrottle.THROTTLE_RATES is bound to api_settings.DEFAULT_THROTTLE_RATES
# at import time, not re-read per-request, so overriding it via Django's
# override_settings doesn't reliably take effect — patch get_rate() directly
# instead of fighting that.


def test_login_is_rate_limited_per_ip():
    _user_with_password(email="throttle@example.com")
    client = APIClient()

    with patch("rest_framework.throttling.SimpleRateThrottle.get_rate", return_value="2/min"):
        for _ in range(2):
            resp = client.post(
                "/api/v1/auth/login", {"email": "throttle@example.com", "password": "wrong"}
            )
            assert resp.status_code == 401

        resp = client.post(
            "/api/v1/auth/login", {"email": "throttle@example.com", "password": "wrong"}
        )
        assert resp.status_code == 429


# --- code-review fix: RefreshView must deny a deactivated account ---


def test_refresh_denies_deactivated_user():
    user = _user_with_password(email="deactivated@example.com")
    client = APIClient()
    login_resp = client.post(
        "/api/v1/auth/login", {"email": "deactivated@example.com", "password": PASSWORD}
    )
    refresh_token = login_resp.json()["data"]["refreshToken"]

    user.is_active = False
    user.save(update_fields=["is_active"])

    resp = client.post("/api/v1/auth/refresh", {"refreshToken": refresh_token})

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


def test_refresh_blacklists_token_when_denying_deactivated_user():
    """The token must be revoked outright, not just refused once — otherwise
    it could still be replayed."""
    user = _user_with_password(email="deactivated2@example.com")
    client = APIClient()
    login_resp = client.post(
        "/api/v1/auth/login", {"email": "deactivated2@example.com", "password": PASSWORD}
    )
    refresh_token = login_resp.json()["data"]["refreshToken"]

    user.is_active = False
    user.save(update_fields=["is_active"])
    client.post("/api/v1/auth/refresh", {"refreshToken": refresh_token})

    user.is_active = True
    user.save(update_fields=["is_active"])
    resp = client.post("/api/v1/auth/refresh", {"refreshToken": refresh_token})

    assert resp.status_code == 401


# --- code-review fix: login lockout must be race-safe under concurrency ---
#
# An HTTP-level "fire N concurrent requests and hope they race" test was
# tried first and rejected: it still passed even with the select_for_update()
# fix reverted, because Python thread scheduling + per-request connection
# overhead doesn't reliably force the interleaving that reproduces the race.
# That's a false-confidence test — it looks like coverage but proves
# nothing. This tests the actual locking primitive directly and
# deterministically instead, with explicit synchronization barriers forcing
# the exact interleaving that would exploit the race if the lock were
# missing: thread A holds the row lock open, thread B's un-blocked start
# time is verified to fall only after A releases it.


@pytest.mark.django_db(transaction=True)
def test_select_for_update_serializes_concurrent_account_lookups():
    import threading
    import time

    from django.db import close_old_connections
    from django.db import transaction as db_transaction

    from accounts.models import User

    user = _user_with_password(email="lock-mechanism@example.com")
    a_holds_lock = threading.Event()
    b_may_start = threading.Event()
    timings = {}

    def thread_a():
        close_old_connections()
        with db_transaction.atomic():
            User.objects.select_for_update().filter(pk=user.pk).first()
            a_holds_lock.set()
            b_may_start.wait(timeout=5)
            time.sleep(0.3)  # hold the lock well past B's attempt to acquire it
        timings["a_released"] = time.monotonic()
        close_old_connections()

    def thread_b():
        a_holds_lock.wait(timeout=5)
        close_old_connections()
        b_may_start.set()
        with db_transaction.atomic():
            User.objects.select_for_update().filter(pk=user.pk).first()
            timings["b_acquired"] = time.monotonic()
        close_old_connections()

    t_a = threading.Thread(target=thread_a)
    t_b = threading.Thread(target=thread_b)
    t_a.start()
    t_b.start()
    t_a.join(timeout=10)
    t_b.join(timeout=10)

    assert "a_released" in timings and "b_acquired" in timings
    # B could only have acquired the lock at or after A released it — if the
    # lock weren't real, B would acquire immediately after b_may_start.set(),
    # well before A's 0.3s hold finishes.
    assert timings["b_acquired"] >= timings["a_released"] - 0.05


# --- multi-role RBAC (docs/MULTI-ROLE-TESTS.md §D): /users/me ---


def test_d3_archetype_precedence_manager_plus_admin_is_admin():
    from accounts.factories import PermissionFactory, RolePermissionFactory

    manager_role = RoleFactory(name="D3 Manager", archetype=RoleArchetype.EMPLOYEE)
    admin_role = RoleFactory(name="D3 Admin", archetype=RoleArchetype.ADMIN)
    permission = PermissionFactory(code="employees.read")
    RolePermissionFactory(role=manager_role, permission=permission, scope_tier=ScopeTier.TEAM)
    RolePermissionFactory(role=admin_role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory()
    user.roles.add(manager_role, admin_role)
    EmployeeFactory(user=user)

    client = APIClient()
    client.force_authenticate(user=user)
    data = client.get("/api/v1/users/me").json()["data"]

    assert data["archetype"] == "admin"
    assert sorted(data["roles"]) == ["D3 Admin", "D3 Manager"]
    assert "employees.read" in data["permissions"]
    assert data["scope"] == {"kind": "org"}


def test_d4_zero_roles_employee_me_is_baseline():
    user = UserFactory(role=None)
    EmployeeFactory(user=user)

    client = APIClient()
    client.force_authenticate(user=user)
    data = client.get("/api/v1/users/me").json()["data"]

    assert data["archetype"] == "employee"
    assert data["roles"] == []
    assert set(data["permissions"]) == baseline_self_permissions()
    assert data["scope"] == {"kind": "self"}
