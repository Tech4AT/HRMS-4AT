"""org_calendar isn't employee-keyed, so the ScopedEndpoint conformance kit in
core.conformance/core.testing (built for ScopedEmployeePermission views tested
across all 7 scope tiers) doesn't apply here - see payroll's own flat
`payroll.manage` config viewsets, which have no ScopedEndpoint either. This
covers the same "wiring" ground core.conformance.run_conformance checks for a
scoped endpoint: the permission is registered, it exists in the database after
migrate, and the startup checks report no mistakes."""

import pytest
from django.core.checks import run_checks

from accounts.models import Permission
from core.checks import check_view_permission_codes
from core.registry import is_registered

pytestmark = pytest.mark.django_db


def test_calendar_manage_is_registered():
    assert is_registered("calendar.manage")


def test_calendar_manage_exists_in_the_database_after_migrate():
    assert Permission.objects.filter(code="calendar.manage").exists()


def test_startup_checks_report_no_wiring_errors_for_this_module():
    problems = [f"{e.id}: {e.msg}" for e in check_view_permission_codes(None)]
    problems += [f"{e.id}: {e.msg}" for e in run_checks() if e.is_serious()]

    assert not problems, "; ".join(problems)
