from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from accounts.models import User
from core.scope import resolve_employee_scope
from employees.models import Department, Employee

pytestmark = pytest.mark.django_db


def _run(*args):
    call_command("seed_demo_org", *args, stdout=StringIO())


def _demo_employees():
    return Employee.objects.filter(employee_code__startswith="DEMO-")


def test_creates_the_eight_people_with_working_logins():
    _run()

    assert _demo_employees().count() == 8
    hana = User.objects.get(email="demo.hana@hrms.local")
    assert hana.check_password("DemoPass123!") and list(hana.roles.values_list("name", flat=True)) == ["HR Admin"]


def test_rebuilds_the_reporting_lines():
    _run()

    eli = Employee.objects.get(employee_code="DEMO-ELI")
    assert eli.manager.employee_code == "DEMO-MAYA"
    assert eli.manager.manager.employee_code == "DEMO-DANA"
    assert Employee.objects.get(employee_code="DEMO-DANA").manager is None


def test_is_idempotent():
    _run()
    _run()

    assert _demo_employees().count() == 8
    assert User.objects.filter(email__startswith="demo.").count() >= 8


def test_the_demo_org_behaves_under_rbac():
    """Dana is a Manager: she reaches herself and her direct report Maya only."""
    _run()

    dana = User.objects.get(email="demo.dana@hrms.local")
    reach = set(
        resolve_employee_scope(dana, "employees.read").values_list("employee_code", flat=True)
    )

    assert reach == {"DEMO-DANA", "DEMO-MAYA"}


def test_remove_deletes_exactly_what_it_created():
    real = Employee.objects.create(
        user=User.objects.create(username="real", email="real@company.example"),
        employee_code="REAL-1",
    )
    _run()

    _run("--remove")

    assert not _demo_employees().exists()
    assert not User.objects.filter(email__startswith="demo.dana").exists()
    assert not Department.objects.filter(name__startswith="Demo ").exists()
    assert Employee.objects.filter(pk=real.pk).exists()


def test_with_leave_creates_one_example_request_per_person():
    from example_leave.models import LeaveRequest

    _run("--with-leave")

    assert LeaveRequest.objects.filter(employee__employee_code__startswith="DEMO-").count() == 8


def test_refuses_to_run_under_production_settings(settings):
    settings.SETTINGS_MODULE = "config.settings.prod"

    with pytest.raises(CommandError, match="production"):
        _run()
