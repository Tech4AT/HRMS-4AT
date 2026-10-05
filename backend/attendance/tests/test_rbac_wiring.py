"""Same "wiring" coverage as org_calendar/tests/test_rbac_wiring.py, but for
attendance.{read,write,approve} — this module's ScopedEmployeePermission views
still go through the standard registry/checks machinery even though the
ScopedEndpoint conformance kit itself isn't used here (see the other test
modules for functional coverage instead)."""

import pytest
from django.core.checks import run_checks

from accounts.models import Permission
from core.checks import check_view_permission_codes
from core.registry import is_registered

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("code", ["attendance.read", "attendance.write", "attendance.approve"])
def test_permission_is_registered(code):
    assert is_registered(code)


@pytest.mark.parametrize("code", ["attendance.read", "attendance.write", "attendance.approve"])
def test_permission_exists_in_the_database_after_migrate(code):
    assert Permission.objects.filter(code=code).exists()


def test_startup_checks_report_no_wiring_errors_for_this_module():
    problems = [f"{e.id}: {e.msg}" for e in check_view_permission_codes(None)]
    problems += [f"{e.id}: {e.msg}" for e in run_checks() if e.is_serious()]

    assert not problems, "; ".join(problems)
