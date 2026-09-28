"""docs/TASKS.md P1-E1-08 — must work reliably in every environment: create
the first admin once, then be a no-op forever after (safe to run on every
deploy)."""

import pytest
from django.core.management import CommandError, call_command

from accounts.models import Role, User
from employees.models import Employee

pytestmark = pytest.mark.django_db

# "HR Admin" already exists in every test DB via
# accounts/migrations/0002_seed_starter_roles — pytest-django's test database
# runs all migrations, data migrations included. Tests use that seeded row
# rather than creating a second one (which would violate Role.name's unique
# constraint).


def test_missing_env_vars_raises(monkeypatch):
    monkeypatch.delenv("INITIAL_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("INITIAL_ADMIN_PASSWORD", raising=False)

    with pytest.raises(CommandError):
        call_command("createinitialadmin")


def test_creates_admin_with_hr_admin_role_and_employee_record(monkeypatch):
    role = Role.objects.get(name="HR Admin")
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "a-real-password-123")

    call_command("createinitialadmin")

    user = User.objects.get(email="admin@example.com")
    assert list(user.roles.values_list("pk", flat=True)) == [role.id]
    assert user.check_password("a-real-password-123")
    assert Employee.objects.filter(user=user).exists()


def test_running_twice_is_a_noop(monkeypatch):
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "admin2@example.com")
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "a-real-password-123")

    call_command("createinitialadmin")
    call_command("createinitialadmin")  # must not raise or create a duplicate

    assert User.objects.filter(email="admin2@example.com").count() == 1


def test_missing_hr_admin_role_raises_clear_error(monkeypatch):
    Role.objects.filter(name="HR Admin").delete()
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "admin3@example.com")
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "a-real-password-123")

    with pytest.raises(CommandError):
        call_command("createinitialadmin")
