"""ScopedEmployeePermission — code-review fix for a pk type-confusion bug:
has_object_permission used to compare obj.pk directly against the scoped
Employee queryset, which is only correct when obj IS an Employee. Since the
class is documented as generic for any employee-keyed model, a future
non-Employee model sharing a pk value with an in-scope Employee would have
been granted/denied access based on coincidental ID overlap between
unrelated tables."""

from unittest.mock import Mock

import pytest
from django.core.exceptions import ImproperlyConfigured
from rest_framework.test import APIRequestFactory

from accounts.factories import PermissionFactory, RoleFactory, RolePermissionFactory, UserFactory
from core.enums import ScopeTier
from core.permissions import ScopedEmployeePermission
from employees.factories import EmployeeFactory

pytestmark = pytest.mark.django_db


def _view_with_permission(code):
    view = Mock()
    view.required_permission = code
    return view


def _request_for(user):
    request = APIRequestFactory().get("/")
    request.user = user
    return request


def test_object_permission_allows_in_scope_employee():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    target = EmployeeFactory()

    perm = ScopedEmployeePermission()
    view = _view_with_permission("employees.read")

    assert perm.has_object_permission(_request_for(user), view, target) is True


def test_object_permission_denies_out_of_scope_employee():
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.SELF)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    target = EmployeeFactory()

    perm = ScopedEmployeePermission()
    view = _view_with_permission("employees.read")

    assert perm.has_object_permission(_request_for(user), view, target) is False


def test_object_with_employee_id_attribute_is_resolved_via_that_fk_not_its_own_pk():
    """The fix's fallback path: an object that ISN'T an Employee but exposes
    an `employee_id` FK (the shape a future LeaveRequest/ExpenseClaim model
    would have) is scope-checked against the FK target, not its own pk."""
    permission = PermissionFactory(code="leave.approve")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.SELF)
    user = UserFactory(role=role)
    caller_employee = EmployeeFactory(user=user)
    unrelated_employee = EmployeeFactory()

    # Construct a fake "LeaveRequest" whose own pk collides with an
    # out-of-scope Employee's pk, but whose employee_id FK correctly points
    # at the in-scope caller. Before the fix this would have been denied
    # (or, in the mirror case, wrongly granted) based on the pk collision
    # instead of the actual employee_id relationship.
    fake_leave_request = Mock(spec=["pk", "employee_id"])
    fake_leave_request.pk = unrelated_employee.pk
    fake_leave_request.employee_id = caller_employee.pk

    perm = ScopedEmployeePermission()
    view = _view_with_permission("leave.approve")

    assert perm.has_object_permission(_request_for(user), view, fake_leave_request) is True


def test_object_without_employee_id_or_employee_type_raises_clear_error():
    """Fail loudly rather than silently comparing an unrelated pk — a
    misconfigured view is a bug to surface immediately, not a security hole
    to paper over with a guess."""
    permission = PermissionFactory(code="employees.read")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=ScopeTier.ALL)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)

    fake_object = Mock(spec=["pk"])
    fake_object.pk = 999

    perm = ScopedEmployeePermission()
    view = _view_with_permission("employees.read")

    with pytest.raises(ImproperlyConfigured):
        perm.has_object_permission(_request_for(user), view, fake_object)


# --- found by running a stand-in plugin against this layer: per-action codes ---


def _view(action, required="leave.read", mapping=None):
    view = Mock()
    view.required_permission = required
    view.action = action
    view.action_permissions = mapping if mapping is not None else {}
    return view


def _holder_of(code, tier=ScopeTier.SELF):
    permission = PermissionFactory(code=code)
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission, scope_tier=tier)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    return user


def test_custom_action_is_authorised_by_its_own_code_not_the_view_wide_one():
    """The privilege-escalation case: a user holding only leave.read must not
    pass has_permission on an `approve` action."""
    reader = _holder_of("leave.read")
    perm = ScopedEmployeePermission()
    view = _view("approve", mapping={"approve": "leave.approve"})

    assert perm.has_permission(_request_for(reader), view) is False


def test_custom_action_is_allowed_for_the_holder_of_its_own_code():
    approver = _holder_of("leave.approve")
    perm = ScopedEmployeePermission()
    view = _view("approve", mapping={"approve": "leave.approve"})

    assert perm.has_permission(_request_for(approver), view) is True


def test_custom_action_without_a_mapping_fails_loudly_instead_of_falling_back():
    reader = _holder_of("leave.read")
    perm = ScopedEmployeePermission()

    with pytest.raises(ImproperlyConfigured):
        perm.has_permission(_request_for(reader), _view("approve"))


def test_object_check_uses_the_actions_own_code_for_scope():
    """Scope must be resolved for leave.approve, not leave.read — a user can
    read broadly (ALL) but approve narrowly (SELF)."""
    permission_read = PermissionFactory(code="leave.read")
    permission_approve = PermissionFactory(code="leave.approve")
    role = RoleFactory()
    RolePermissionFactory(role=role, permission=permission_read, scope_tier=ScopeTier.ALL)
    RolePermissionFactory(role=role, permission=permission_approve, scope_tier=ScopeTier.SELF)
    user = UserFactory(role=role)
    EmployeeFactory(user=user)
    someone_else = EmployeeFactory()

    perm = ScopedEmployeePermission()
    view = _view("approve", mapping={"approve": "leave.approve"})

    assert perm.has_object_permission(_request_for(user), view, someone_else) is False


@pytest.mark.parametrize("action", ["list", "retrieve", None])
def test_read_actions_use_the_view_wide_code(action):
    reader = _holder_of("leave.read")
    perm = ScopedEmployeePermission()

    assert perm.has_permission(_request_for(reader), _view(action)) is True


# --- write actions need their own permission: read must never authorise writing ---

WRITE = ["create", "update", "partial_update", "destroy"]


@pytest.mark.parametrize("action", WRITE)
def test_a_write_action_without_a_write_permission_fails_loudly(action):
    reader = _holder_of("leave.read")
    perm = ScopedEmployeePermission()

    with pytest.raises(ImproperlyConfigured, match="write_permission"):
        perm.has_permission(_request_for(reader), _view(action))


@pytest.mark.parametrize("action", WRITE)
def test_read_only_holder_is_refused_a_write_action(action):
    # NOTE (test-v1 x leave_attendance merge): these codes must stay outside
    # every registered module namespace. baseline_self_permissions() grants
    # any registered "<module>.write" with an Employee SELF default to every
    # employee, so the real "leave.write" (self-service "Submit leave
    # requests", same design as example_leave.write) is legitimately held
    # here and would make this assertion pass for the wrong reason.
    reader = _holder_of("widget.read")
    view = _view(action)
    view.write_permission = "widget.write"

    assert ScopedEmployeePermission().has_permission(_request_for(reader), view) is False


@pytest.mark.parametrize("action", WRITE)
def test_write_permission_holder_may_perform_a_write_action(action):
    writer = _holder_of("widget.write")
    view = _view(action)
    view.write_permission = "widget.write"

    assert ScopedEmployeePermission().has_permission(_request_for(writer), view) is True


def test_a_write_action_can_instead_be_mapped_individually():
    deleter = _holder_of("leave.delete")
    view = _view("destroy", mapping={"destroy": "leave.delete"})

    assert ScopedEmployeePermission().has_permission(_request_for(deleter), view) is True


def test_flat_capability_views_keep_one_code_for_every_action():
    """HasPermissionCode (e.g. everything under roles.manage) is deliberately unchanged."""
    from core.permissions import HasPermissionCode

    admin = _holder_of("leave.read")
    for action in ["list", "create", "destroy"]:
        assert HasPermissionCode().has_permission(_request_for(admin), _view(action)) is True
