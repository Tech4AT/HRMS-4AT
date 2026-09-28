"""PLAN.md Step 12's concurrency check. Two simultaneous, non-overlapping
leave requests against the *same* balance row, from two real threads (each
gets its own DB connection, unlike a single-transaction test) — without the
`select_for_update()` locking added alongside this test, both requests would
read the same starting `used` value, both pass the balance check, and the
second `save()` would silently overwrite the first's deduction, leaving the
balance short by one request's worth of days. `transaction=True` is required
for a real multi-connection race: the default `django_db` marker wraps the
whole test in one uncommitted transaction, which a second thread can't see
into (and would just deadlock against, not genuinely race).

Builds its own Role/Permission/RolePermission rows via `get_or_create` rather
than assuming the migration-seeded "Employee" role and its grants are present
— `transaction=True` tests flush the whole database (including that seeded
data) as part of their own setup/teardown, and back-to-back `transaction=True`
tests in the same session (this one runs right after accounts/tests/
test_auth.py's own select_for_update concurrency test) can observe that
seeded data gone rather than restored. Sidestepping the dependency entirely
is more robust than relying on inter-test restoration timing."""

import threading
from decimal import Decimal

import pytest
from django.db import close_old_connections
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Permission, Role, RolePermission
from core.enums import RoleArchetype, ScopeTier
from employees.factories import EmployeeFactory
from leave.models import LeaveBalance, LeaveType

pytestmark = pytest.mark.django_db(transaction=True)

URL = "/api/v1/leave/requests"


def _employee_with_leave_write():
    role, _ = Role.objects.get_or_create(
        name="Concurrency Test Employee", defaults={"archetype": RoleArchetype.EMPLOYEE}
    )
    for code in ("leave.read", "leave.write"):
        permission, _ = Permission.objects.get_or_create(code=code)
        RolePermission.objects.get_or_create(
            role=role, permission=permission, defaults={"scope_tier": ScopeTier.SELF}
        )
    user = UserFactory(role=role)
    return EmployeeFactory(user=user), user


def test_two_concurrent_auto_approved_requests_both_deduct_from_the_balance():
    _employee, user = _employee_with_leave_write()
    leave_type = LeaveType.objects.create(
        name="Casual Leave", annual_allocation=Decimal("20"), requires_approval=False
    )
    # Seed the balance up front so both threads race on an *existing* row,
    # not on LeaveBalance's own (already get_or_create-safe) creation race.
    LeaveBalance.objects.create(
        employee=_employee, leave_type=leave_type, financial_year="2026", allocated=Decimal("20")
    )

    barrier = threading.Barrier(2)
    results = []

    def submit(start_date: str):
        # A fresh OS thread can reuse an identity django.db.connections has
        # cached from an earlier test's own thread — close_old_connections()
        # is the established pattern for this exact scenario, matching
        # accounts/tests/test_auth.py's own select_for_update concurrency test.
        close_old_connections()
        try:
            barrier.wait(timeout=5)  # line both threads up to maximise overlap
            client = APIClient()
            client.force_authenticate(user=user)
            response = client.post(
                URL,
                {
                    "leave_type_id": str(leave_type.pk),
                    "start_date": start_date,
                    "end_date": start_date,
                },
                format="json",
            )
            results.append(response.status_code)
        finally:
            close_old_connections()

    threads = [
        threading.Thread(target=submit, args=("2026-03-02",)),
        threading.Thread(target=submit, args=("2026-03-03",)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert results == [201, 201]
    balance = LeaveBalance.objects.get(
        employee=_employee, leave_type=leave_type, financial_year="2026"
    )
    assert balance.used == Decimal("2")  # both 1-day requests applied - not lost to a race
