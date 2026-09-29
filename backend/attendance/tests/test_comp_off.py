from decimal import Decimal

import pytest
from django.utils import timezone

from accounts.factories import UserFactory
from accounts.models import Role
from attendance.comp_off import accrue_comp_off
from attendance.models import CompOffAccrualState, PolicySettings
from employees.factories import EmployeeFactory
from leave.models import LeaveBalance, LeaveType
from notifications.models import Notification

pytestmark = pytest.mark.django_db


def _employee():
    user = UserFactory(role=Role.objects.get(name="Employee"))
    return EmployeeFactory(user=user)


def _leave_type(**overrides):
    defaults = {"name": "Comp Offs", "annual_allocation": Decimal("0")}
    defaults.update(overrides)
    return LeaveType.objects.create(**defaults)


def test_credits_one_comp_off_when_the_threshold_is_crossed_exactly():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "comp_off_leave_type": leave_type,
            "comp_off_accrual_overtime_hours_per_comp_off": Decimal("8"),
        },
    )

    credited = accrue_comp_off(employee, 480)  # exactly 8h

    assert credited == 1
    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("1")
    state = CompOffAccrualState.objects.get(employee=employee)
    assert state.uncredited_overtime_minutes == 0
    assert Notification.objects.filter(user=employee.user, type="comp_off.accrued").exists()


def test_partial_overtime_is_banked_not_credited():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "comp_off_leave_type": leave_type,
            "comp_off_accrual_overtime_hours_per_comp_off": Decimal("8"),
        },
    )

    credited = accrue_comp_off(employee, 200)

    assert credited == 0
    assert not LeaveBalance.objects.filter(employee=employee).exists()
    state = CompOffAccrualState.objects.get(employee=employee)
    assert state.uncredited_overtime_minutes == 200


def test_remainder_carries_forward_across_calls_until_it_crosses_the_threshold():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "comp_off_leave_type": leave_type,
            "comp_off_accrual_overtime_hours_per_comp_off": Decimal("8"),
        },
    )

    assert accrue_comp_off(employee, 300) == 0
    assert accrue_comp_off(employee, 300) == 1  # 600 total >= 480 threshold

    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("1")
    state = CompOffAccrualState.objects.get(employee=employee)
    assert state.uncredited_overtime_minutes == 120  # 600 - 480 remainder kept, not discarded


def test_credits_multiple_comp_offs_in_a_single_call_when_overtime_crosses_the_threshold_twice():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "comp_off_leave_type": leave_type,
            "comp_off_accrual_overtime_hours_per_comp_off": Decimal("8"),
        },
    )

    credited = accrue_comp_off(employee, 1000)  # two full 8h thresholds, 40m left over

    assert credited == 2
    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("2")
    state = CompOffAccrualState.objects.get(employee=employee)
    assert state.uncredited_overtime_minutes == 40


def test_does_not_credit_when_accrual_is_disabled():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={"comp_off_leave_type": leave_type, "comp_off_accrual_enabled": False},
    )

    credited = accrue_comp_off(employee, 480)

    assert credited == 0
    assert not LeaveBalance.objects.filter(employee=employee).exists()
    assert not CompOffAccrualState.objects.filter(employee=employee).exists()


def test_does_not_credit_when_no_leave_type_is_configured():
    employee = _employee()
    # Default PolicySettings has no comp_off_leave_type configured.

    credited = accrue_comp_off(employee, 480)

    assert credited == 0
    assert not CompOffAccrualState.objects.filter(employee=employee).exists()


def test_none_overtime_is_a_no_op():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(pk=1, defaults={"comp_off_leave_type": leave_type})

    credited = accrue_comp_off(employee, None)

    assert credited == 0
    assert not CompOffAccrualState.objects.filter(employee=employee).exists()


def test_adds_to_an_existing_balance_already_credited_by_a_previous_penalisation_or_accrual():
    employee = _employee()
    leave_type = _leave_type()
    PolicySettings.objects.update_or_create(
        pk=1,
        defaults={
            "comp_off_leave_type": leave_type,
            "comp_off_accrual_overtime_hours_per_comp_off": Decimal("8"),
        },
    )
    LeaveBalance.objects.create(
        employee=employee,
        leave_type=leave_type,
        financial_year=str(timezone.localdate().year),
        allocated=Decimal("3"),
    )

    accrue_comp_off(employee, 480)

    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type)
    assert balance.allocated == Decimal("4")
