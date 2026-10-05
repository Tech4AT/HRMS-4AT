"""T07 — bulk-provision logins for employees with unusable passwords.

Covers docs/RBAC-TESTS.md [T07] item 8:
- unusable-password user gets provisioned + flagged (must_change_password),
  with one audit row and one CSV row;
- usable-password user is skipped without --force (and reset with --force);
- --dry-run changes nothing (no password, no audit row, no CSV file).
"""

import csv

import pytest
from django.core.management import call_command

from accounts.factories import UserFactory
from accounts.models import User
from audit.models import AuditLog
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


def _employee_user(**kwargs):
    """An active employee-linked user with an unusable password."""
    user = UserFactory(**kwargs)
    user.set_unusable_password()
    user.must_change_password = False
    user.save(update_fields=["password", "must_change_password"])
    EmployeeFactory(user=user)
    return user


def _read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_provisions_unusable_user_flags_and_audits(tmp_path):
    user = _employee_user()
    out = tmp_path / "logins.csv"

    call_command("provision_logins", f"--out={out}")

    user.refresh_from_db()
    assert user.has_usable_password()
    assert user.must_change_password is True
    rows = _read_csv(out)
    assert [r["email"] for r in rows] == [user.email]
    assert rows[0]["temporary_password"]
    assert user.check_password(rows[0]["temporary_password"])
    assert AuditLog.objects.filter(
        action="User.login_provisioned", entity_type="User", entity_id=str(user.pk)
    ).count() == 1


def test_skips_usable_user_without_force(tmp_path):
    user = _employee_user()
    user.set_password("Already-Usable-1")
    user.save(update_fields=["password"])
    out = tmp_path / "logins.csv"

    call_command("provision_logins", f"--out={out}")

    user.refresh_from_db()
    assert user.check_password("Already-Usable-1")
    assert user.must_change_password is False
    assert _read_csv(out) == []
    assert not AuditLog.objects.filter(action="User.login_provisioned").exists()


def test_force_resets_usable_user(tmp_path):
    user = _employee_user()
    user.set_password("Already-Usable-1")
    user.save(update_fields=["password"])
    out = tmp_path / "logins.csv"

    call_command("provision_logins", "--force", f"--out={out}")

    user.refresh_from_db()
    assert not user.check_password("Already-Usable-1")
    assert user.must_change_password is True
    assert [r["email"] for r in _read_csv(out)] == [user.email]


def test_dry_run_changes_nothing(tmp_path):
    user = _employee_user()
    out = tmp_path / "logins.csv"

    call_command("provision_logins", "--dry-run", f"--out={out}")

    user.refresh_from_db()
    assert not user.has_usable_password()
    assert user.must_change_password is False
    assert not AuditLog.objects.filter(action="User.login_provisioned").exists()
    assert not out.exists()


def test_inactive_and_unlinked_users_ignored(tmp_path):
    inactive = _employee_user(is_active=False)
    unlinked = UserFactory()
    unlinked.set_unusable_password()
    unlinked.save(update_fields=["password"])
    out = tmp_path / "logins.csv"

    call_command("provision_logins", f"--out={out}")

    assert _read_csv(out) == []
    inactive.refresh_from_db()
    assert not inactive.has_usable_password()
    unlinked.refresh_from_db()
    assert not unlinked.has_usable_password()
    assert User.objects.filter(pk=inactive.pk).exists()
