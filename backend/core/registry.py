"""Permission registry: how a module tells the core which permissions it owns.

A module declares them in code, in `<app>/rbac.py`, instead of hand-writing a
data migration:

    from core.enums import ScopeTier
    from core.registry import PermissionSpec, register_permissions

    register_permissions(
        PermissionSpec(
            "leave.read",
            "View leave requests",
            default_grants={"Employee": ScopeTier.SELF, "Manager": ScopeTier.MANAGER,
                            "HR Admin": ScopeTier.ALL},
        ),
        PermissionSpec("leave.approve", "Approve leave requests",
                       default_grants={"Manager": ScopeTier.MANAGER, "HR Admin": ScopeTier.ALL}),
    )

`<app>/rbac.py` is imported automatically at startup (core.apps.CoreConfig.ready)
and synced to the database after every `migrate`:

- The Permission row is created if it does not exist.
- `default_grants` (role name -> scope tier) are written ONLY when the
  permission is created for the first time. An admin who later widens, narrows
  or removes a role's grant keeps their change; a re-run never overwrites it.
- A role named in default_grants that does not exist is skipped, not an error,
  so a module can name roles an organisation has not created.

The registry is also what the startup check in core.checks compares view
permission codes against, so a typo in `required_permission` fails at startup
instead of silently locking everyone out.
"""

from dataclasses import dataclass, field

from core.enums import ScopeTier


@dataclass(frozen=True)
class PermissionSpec:
    code: str
    description: str = ""
    label: str = ""  # short verb phrase for the checkbox row ("View payslips")
    group: str = ""  # feature area for UI grouping; defaults to the module label
    default_grants: dict = field(default_factory=dict)  # role name -> ScopeTier


@dataclass(frozen=True)
class ModuleSpec:
    key: str  # e.g. "payroll" — stable, matches the permission code prefix
    label: str = ""  # feature-area name shown as a group header
    enabled: bool = True  # False = hidden from the role UI catalog until built
    permissions: tuple = ()  # PermissionSpec entries owned by this module


_REGISTRY: dict[str, PermissionSpec] = {}
_MODULES: dict[str, ModuleSpec] = {}
_PERMISSION_MODULE: dict[str, str] = {}  # permission code -> module key


def register_permissions(*specs: PermissionSpec) -> None:
    for spec in specs:
        _validate(spec)
        existing = _REGISTRY.get(spec.code)
        if existing is not None and existing != spec:
            raise ValueError(
                f"Permission {spec.code!r} is registered twice with different definitions. "
                "A permission code has exactly one owning module."
            )
        _REGISTRY[spec.code] = spec


def _validate(spec: PermissionSpec) -> None:
    parts = spec.code.split(".")
    if len(parts) < 2 or not all(part and part == part.lower().strip() for part in parts):
        raise ValueError(
            f"Permission code {spec.code!r} must be lower-case dot-notation, "
            "'<module>.<action>' (for example 'leave.approve')."
        )
    for role_name, tier in spec.default_grants.items():
        if tier not in ScopeTier.values:
            raise ValueError(
                f"{spec.code}: default grant for {role_name!r} uses unknown scope tier {tier!r}. "
                f"Use one of {ScopeTier.values}."
            )


def register_module(spec: ModuleSpec) -> None:
    """A module declares itself once: its feature-area label, whether it is
    built yet, and the permissions it owns. Idempotent — re-registering the
    identical spec (e.g. on app reload) is a no-op."""
    if not spec.key or spec.key != spec.key.lower().strip():
        raise ValueError(
            f"Module key {spec.key!r} must be a lower-case slug (for example 'payroll')."
        )
    existing = _MODULES.get(spec.key)
    if existing is not None:
        if existing == spec:
            return
        raise ValueError(
            f"Module {spec.key!r} is registered twice with different definitions."
        )
    _MODULES[spec.key] = spec
    register_permissions(*spec.permissions)
    for perm in spec.permissions:
        _PERMISSION_MODULE.setdefault(perm.code, spec.key)


def registered_modules(*, enabled_only: bool = False) -> dict[str, ModuleSpec]:
    modules = dict(_MODULES)
    if enabled_only:
        modules = {k: m for k, m in modules.items() if m.enabled}
    return modules


def is_module_enabled(key: str) -> bool:
    module = _MODULES.get(key)
    return module.enabled if module is not None else True


def permission_group(code: str) -> str:
    """Authoritative UI group for a permission: its explicit `group`, else its
    module's label, else the prefix-guess (for legacy specs with no module)."""
    spec = _REGISTRY.get(code)
    if spec is not None and spec.group:
        return spec.group
    module_key = _PERMISSION_MODULE.get(code)
    if module_key is not None:
        label = _MODULES[module_key].label
        if label:
            return label
    return code.split(".")[0]


def permission_label(code: str) -> str:
    spec = _REGISTRY.get(code)
    if spec is None:
        return code
    return spec.label or spec.description or spec.code


def enabled_permission_codes() -> set[str]:
    """Codes the role UI may offer: everything except permissions owned by a
    module registered with `enabled=False`. Legacy specs with no module stay
    visible (backward compatible)."""
    visible = set()
    for code in _REGISTRY:
        module_key = _PERMISSION_MODULE.get(code)
        if module_key is None or is_module_enabled(module_key):
            visible.add(code)
    return visible



def registered_permissions() -> dict[str, PermissionSpec]:
    return dict(_REGISTRY)


def is_registered(code: str) -> bool:
    return code in _REGISTRY


def sync_registered_permissions() -> dict:
    """Bring the database in line with the registry. Idempotent. Returns a
    summary: which permissions were created and which default grants were
    written or skipped."""
    from accounts.models import Permission, Role, RolePermission

    summary = {"created": [], "grants_written": [], "grants_skipped": []}
    for spec in _REGISTRY.values():
        permission, created = Permission.objects.get_or_create(
            code=spec.code,
            defaults={
                "description": spec.description,
                "label": spec.label,
                "group": permission_group(spec.code),
            },
        )
        if not created:
            # Fill blanks from code, but never overwrite an admin's edit —
            # the same rule `description` has always had.
            touched = []
            if spec.description and not permission.description:
                permission.description = spec.description
                touched.append("description")
            if spec.label and not permission.label:
                permission.label = spec.label
                touched.append("label")
            group = permission_group(spec.code)
            if group and not permission.group:
                permission.group = group
                touched.append("group")
            if touched:
                permission.save(update_fields=touched)
            continue

        summary["created"].append(spec.code)
        for role_name, tier in spec.default_grants.items():
            role = Role.objects.filter(name=role_name).first()
            if role is None:
                summary["grants_skipped"].append((spec.code, role_name))
                continue
            RolePermission.objects.get_or_create(
                role=role, permission=permission, defaults={"scope_tier": tier}
            )
            summary["grants_written"].append((spec.code, role_name, str(tier)))
    return summary
