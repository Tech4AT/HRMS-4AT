"""The permission registry (how modules declare permissions) and the startup
checks that catch mis-wired views."""

import pytest
from django.core.management import call_command
from django.core.management.base import SystemCheckError

from accounts.factories import RoleFactory
from accounts.models import Permission, RolePermission
from core import registry
from core.checks import check_view_permission_codes
from core.enums import ScopeTier
from core.registry import (
    ModuleSpec,
    PermissionSpec,
    register_module,
    register_permissions,
    sync_registered_permissions,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def empty_registry(monkeypatch):
    monkeypatch.setattr(registry, "_REGISTRY", {})
    monkeypatch.setattr(registry, "_MODULES", {})
    monkeypatch.setattr(registry, "_PERMISSION_MODULE", {})


# --- registration ---------------------------------------------------------


def test_bad_code_shapes_are_rejected(empty_registry):
    for bad in ["leave", "Leave.Read", "leave..read", ".read", "leave. read"]:
        with pytest.raises(ValueError, match="dot-notation"):
            register_permissions(PermissionSpec(bad))


def test_unknown_scope_tier_in_a_default_grant_is_rejected(empty_registry):
    with pytest.raises(ValueError, match="unknown scope tier"):
        register_permissions(PermissionSpec("leave.read", default_grants={"Employee": "galaxy"}))


def test_registering_the_same_definition_twice_is_fine(empty_registry):
    spec = PermissionSpec("leave.read", "Read leave")
    register_permissions(spec)
    register_permissions(spec)

    assert list(registry.registered_permissions()) == ["leave.read"]


def test_two_modules_cannot_claim_one_code_with_different_definitions(empty_registry):
    register_permissions(PermissionSpec("leave.read", "Read leave"))

    with pytest.raises(ValueError, match="registered twice"):
        register_permissions(PermissionSpec("leave.read", "Something else"))


# --- module self-registration ------------------------------------------------


def test_register_module_registers_its_permissions(empty_registry):
    register_module(
        ModuleSpec(
            key="payroll",
            label="Payroll",
            enabled=True,
            permissions=(
                PermissionSpec("payroll.read", "View payroll", label="View payroll records",
                               group="Payroll"),
            ),
        )
    )

    assert registry.is_registered("payroll.read")
    assert registry.permission_group("payroll.read") == "Payroll"
    assert registry.permission_label("payroll.read") == "View payroll records"
    assert registry.is_module_enabled("payroll")


def test_register_module_is_idempotent(empty_registry):
    spec = ModuleSpec(key="payroll", label="Payroll", enabled=True, permissions=())
    register_module(spec)
    register_module(spec)

    assert list(registry.registered_modules()) == ["payroll"]


def test_register_module_with_a_different_definition_is_rejected(empty_registry):
    register_module(ModuleSpec(key="payroll", label="Payroll"))
    with pytest.raises(ValueError, match="registered twice"):
        register_module(ModuleSpec(key="payroll", label="Something else"))


def test_bad_module_keys_are_rejected(empty_registry):
    for bad in ["", "Payroll", " payroll "]:
        with pytest.raises(ValueError, match="lower-case slug"):
            register_module(ModuleSpec(key=bad))


def test_permission_group_defaults_to_the_module_label(empty_registry):
    register_module(
        ModuleSpec(
            key="payroll",
            label="Payroll",
            permissions=(PermissionSpec("payroll.read", "View payroll"),),
        )
    )

    assert registry.permission_group("payroll.read") == "Payroll"


def test_permission_label_falls_back_to_description_then_code(empty_registry):
    register_permissions(
        PermissionSpec("legacy.read", "Legacy description"),
        PermissionSpec("bare.write"),
    )

    assert registry.permission_label("legacy.read") == "Legacy description"
    assert registry.permission_label("bare.write") == "bare.write"


def test_enabled_permission_codes_excludes_disabled_modules(empty_registry):
    register_module(
        ModuleSpec(
            key="payroll", label="Payroll", enabled=True,
            permissions=(PermissionSpec("payroll.read"),),
        )
    )
    register_module(
        ModuleSpec(
            key="example_leave", label="Leaves & attendance", enabled=False,
            permissions=(PermissionSpec("example_leave.read"),),
        )
    )
    register_permissions(PermissionSpec("legacy.read"))

    assert registry.enabled_permission_codes() == {"payroll.read", "legacy.read"}


def test_unknown_module_keys_count_as_enabled(empty_registry):
    assert registry.is_module_enabled("never.registered") is True


# --- database sync --------------------------------------------------------


def test_sync_creates_the_permission_and_its_default_grants(empty_registry):
    employee_role = RoleFactory(name="Test Employee Role")
    manager_role = RoleFactory(name="Test Manager Role")
    register_permissions(
        PermissionSpec(
            "zleave.read",
            "Read leave",
            default_grants={
                "Test Employee Role": ScopeTier.SELF,
                "Test Manager Role": ScopeTier.MANAGER,
            },
        )
    )

    summary = sync_registered_permissions()

    permission = Permission.objects.get(code="zleave.read")
    assert permission.description == "Read leave"
    assert summary["created"] == ["zleave.read"]
    grants = {
        rp.role_id: rp.scope_tier for rp in RolePermission.objects.filter(permission=permission)
    }
    assert grants == {employee_role.pk: "self", manager_role.pk: "manager"}


def test_sync_is_idempotent(empty_registry):
    RoleFactory(name="Test Employee Role")
    register_permissions(
        PermissionSpec("zleave.read", default_grants={"Test Employee Role": ScopeTier.SELF})
    )

    sync_registered_permissions()
    second = sync_registered_permissions()

    assert second["created"] == []
    assert RolePermission.objects.filter(permission__code="zleave.read").count() == 1


def test_sync_never_overwrites_an_admins_later_change(empty_registry):
    """The point of writing grants only on first creation: an admin who widens,
    narrows or removes a default keeps that decision across every later migrate."""
    widened = RoleFactory(name="Test Widened Role")
    removed = RoleFactory(name="Test Removed Role")
    register_permissions(
        PermissionSpec(
            "zleave.read",
            default_grants={
                "Test Widened Role": ScopeTier.SELF,
                "Test Removed Role": ScopeTier.SELF,
            },
        )
    )
    sync_registered_permissions()

    RolePermission.objects.filter(role=widened).update(scope_tier=ScopeTier.ALL)
    RolePermission.objects.filter(role=removed).delete()
    sync_registered_permissions()

    assert RolePermission.objects.get(role=widened).scope_tier == "all"
    assert not RolePermission.objects.filter(role=removed).exists()


def test_a_default_grant_for_a_role_that_does_not_exist_is_skipped(empty_registry):
    register_permissions(
        PermissionSpec("zleave.read", default_grants={"No Such Role": ScopeTier.ALL})
    )

    summary = sync_registered_permissions()

    assert summary["grants_skipped"] == [("zleave.read", "No Such Role")]
    assert Permission.objects.filter(code="zleave.read").exists()


def test_sync_fills_a_blank_description_but_keeps_an_edited_one(empty_registry):
    Permission.objects.create(code="zblank.read", description="")
    Permission.objects.create(code="zedited.read", description="Edited by an admin")
    register_permissions(
        PermissionSpec("zblank.read", "From code"), PermissionSpec("zedited.read", "From code")
    )

    sync_registered_permissions()

    assert Permission.objects.get(code="zblank.read").description == "From code"
    assert Permission.objects.get(code="zedited.read").description == "Edited by an admin"


def test_migrate_registers_the_core_permissions():
    """The real registry, populated by employees/rbac.py and accounts/rbac.py."""
    codes = set(Permission.objects.values_list("code", flat=True))

    assert {"employees.read", "employees.write", "roles.manage"} <= codes


# --- startup checks -------------------------------------------------------


def _errors_for_broken_views(settings):
    settings.ROOT_URLCONF = "core.tests.urls_broken_views"
    return check_view_permission_codes(None)


def test_check_flags_a_typo_in_required_permission(settings):
    errors = _errors_for_broken_views(settings)

    typo = [e for e in errors if "TypoCodeViewSet" in e.msg]
    assert [e.id for e in typo] == ["core.E001"]
    assert "employees.raed" in typo[0].msg


def test_check_flags_a_view_with_no_required_permission(settings):
    errors = _errors_for_broken_views(settings)

    assert [e.id for e in errors if "MissingCodeViewSet" in e.msg] == ["core.E002"]


def test_check_flags_a_custom_action_with_no_mapping(settings):
    errors = _errors_for_broken_views(settings)

    unmapped = [e for e in errors if "UnmappedActionViewSet" in e.msg]
    assert [e.id for e in unmapped] == ["core.E003"]
    assert "approve" in unmapped[0].msg


def test_check_flags_an_action_mapped_to_an_unregistered_code(settings):
    errors = _errors_for_broken_views(settings)

    flagged = [e for e in errors if "UnregisteredActionCodeViewSet" in e.msg]
    assert [e.id for e in flagged] == ["core.E001"]
    assert "leaves.approve" in flagged[0].msg


def test_check_flags_a_write_action_with_no_write_permission(settings):
    errors = _errors_for_broken_views(settings)

    flagged = [e for e in errors if "WriteWithoutPermissionViewSet" in e.msg]
    assert [e.id for e in flagged] == ["core.E004"]
    assert "create" in flagged[0].msg


def test_check_passes_a_correctly_wired_view(settings):
    errors = _errors_for_broken_views(settings)

    assert not [e for e in errors if "CorrectViewSet" in e.msg]


def test_the_real_project_has_no_wiring_errors():
    """Guards every module added later: this fails the moment any view in the
    project names an unregistered code or leaves a custom action unmapped."""
    assert check_view_permission_codes(None) == []


def test_manage_py_check_fails_loudly_on_broken_views(settings):
    settings.ROOT_URLCONF = "core.tests.urls_broken_views"

    with pytest.raises(SystemCheckError, match="core.E001"):
        call_command("check")
