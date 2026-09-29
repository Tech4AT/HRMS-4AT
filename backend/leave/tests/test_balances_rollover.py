from decimal import Decimal

import pytest
from django.core.management import call_command

from accounts.factories import UserFactory
from accounts.models import Role
from audit.models import AuditLog
from employees.factories import EmployeeFactory
from leave.balances import get_or_seed_balance
from leave.models import LeaveBalance, LeaveType

pytestmark = pytest.mark.django_db


def _employee():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    return EmployeeFactory(user=user)


def test_no_previous_year_seeds_with_zero_carry_forward():
    employee = _employee()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("6"), carry_forward_limit=Decimal("3")
    )

    balance, created = get_or_seed_balance(employee, leave_type, "2026")

    assert created is True
    assert balance.allocated == Decimal("6")
    assert balance.carry_forward == Decimal("0")


def test_unused_balance_under_the_cap_carries_forward_in_full():
    employee = _employee()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("6"), carry_forward_limit=Decimal("5")
    )
    LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year="2025",
        allocated=Decimal("6"),
        used=Decimal("4"),
    )  # available = 2, under the cap of 5

    balance, created = get_or_seed_balance(employee, leave_type, "2026")

    assert created is True
    assert balance.carry_forward == Decimal("2")


def test_unused_balance_over_the_cap_is_capped_and_the_rest_lapses():
    employee = _employee()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("6"), carry_forward_limit=Decimal("3")
    )
    previous = LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year="2025",
        allocated=Decimal("10"),
        used=Decimal("2"),
    )  # available = 8, cap is 3 -> 3 carries, 5 lapses

    balance, _created = get_or_seed_balance(employee, leave_type, "2026")

    assert balance.carry_forward == Decimal("3")
    previous.refresh_from_db()
    assert previous.lapsed == Decimal("5")


def test_negative_available_balance_does_not_carry_forward_or_go_negative():
    employee = _employee()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("6"), carry_forward_limit=Decimal("3")
    )
    LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year="2025",
        allocated=Decimal("2"),
        used=Decimal("5"),
    )  # available = -3

    balance, _created = get_or_seed_balance(employee, leave_type, "2026")

    assert balance.carry_forward == Decimal("0")


def test_calling_twice_for_the_same_year_does_not_reseed_or_recompute():
    employee = _employee()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("6"), carry_forward_limit=Decimal("3")
    )
    LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year="2025",
        allocated=Decimal("6"),
        used=Decimal("0"),
    )

    first, first_created = get_or_seed_balance(employee, leave_type, "2026")
    first.used = Decimal("2")
    first.save(update_fields=["used"])
    second, second_created = get_or_seed_balance(employee, leave_type, "2026")

    assert first_created is True
    assert second_created is False
    assert second.pk == first.pk
    assert second.used == Decimal("2")  # untouched by the second call


def test_seeding_writes_an_audit_entry():
    employee = _employee()
    leave_type = LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("6"))

    balance, _created = get_or_seed_balance(employee, leave_type, "2026")

    assert AuditLog.objects.filter(action="LeaveBalance.seeded", entity_id=str(balance.pk)).exists()


def test_roll_leave_balances_command_is_idempotent():
    employee = _employee()
    LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("6"))

    call_command("roll_leave_balances", "--year", "2026")
    count_after_first = LeaveBalance.objects.filter(
        employee=employee, financial_year="2026"
    ).count()
    call_command("roll_leave_balances", "--year", "2026")
    count_after_second = LeaveBalance.objects.filter(
        employee=employee, financial_year="2026"
    ).count()

    assert count_after_first == 1
    assert count_after_second == 1


def test_roll_leave_balances_command_skips_inactive_employees_and_types():
    active_employee = _employee()
    inactive_employee = _employee()
    inactive_employee.status = "exited"
    inactive_employee.save(update_fields=["status"])
    LeaveType.objects.create(name="Casual Leave", annual_allocation=Decimal("6"))
    inactive_type = LeaveType.objects.create(name="Retired Leave", annual_allocation=Decimal("6"))
    inactive_type.status = "inactive"
    inactive_type.save(update_fields=["status"])

    call_command("roll_leave_balances", "--year", "2026")

    assert LeaveBalance.objects.filter(employee=active_employee, financial_year="2026").count() == 1
    assert not LeaveBalance.objects.filter(
        employee=inactive_employee, financial_year="2026"
    ).exists()
    assert not LeaveBalance.objects.filter(leave_type=inactive_type, financial_year="2026").exists()
