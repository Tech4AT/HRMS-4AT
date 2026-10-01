"""Payroll passes the core conformance kit (read-scoping), and the kit fails
when the module's scoping is broken."""

import pytest

from core.testing import assert_module_conforms
from employees.models import Employee
from payroll.conformance import ENDPOINT
from payroll.views import base as views

pytestmark = pytest.mark.django_db


def test_payroll_module_conforms():
    verifier = assert_module_conforms(ENDPOINT)
    assert verifier.passed >= 10


def test_kit_catches_a_list_that_ignores_scope(monkeypatch):
    """If the compensation list returned everyone instead of the caller's scope,
    the kit must fail (the salary-privacy IDOR)."""
    monkeypatch.setattr(views, "resolve_employee_scope", lambda user, code: Employee.objects.all())
    with pytest.raises(AssertionError, match="list under 'self'"):
        assert_module_conforms(ENDPOINT)
