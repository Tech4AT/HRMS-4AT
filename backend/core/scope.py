"""core/scope.py::resolve_employee_scope — the single most important function in
the codebase. It is the direct fix for a confirmed, live IDOR vulnerability (any
employee could previously read any other employee's data by changing an ID in a
URL). Every employee-keyed queryset in every module must filter through this
function's result rather than re-implementing any tier's logic locally:

    Employee.objects.filter(pk__in=resolve_employee_scope(user, "leave.approve"))

See docs/ARCHITECTURE.md's "Scope resolution" section for the design this
implements, and docs/REQUIREMENTS.md §0 for what each tier means in product terms.
"""

from django.db import connection
from django.db.models import Q, QuerySet

from accounts.models import RolePermission, UserPermissionOverride
from core.enums import RoleArchetype, ScopeTier
from core.registry import registered_permissions
from employees.models import Employee

# Every person with an employee record is also a plain employee, whatever their
# job role — so they always keep the "own stuff" self-service permissions, at SELF
# tier, even if their role never granted them. This is a floor, not a ceiling: a
# role may still widen any of these to a broader tier, and an explicit
# UserPermissionOverride deny still wins (so access can be revoked). The set is
# every registered permission whose default grant to the plain Employee role is
# SELF (see each module's rbac.py), so a new module's self-service codes join the
# baseline automatically.
def baseline_self_permissions() -> frozenset:
    return frozenset(
        code
        for code, spec in registered_permissions().items()
        if spec.default_grants.get("Employee") == ScopeTier.SELF
    )


# Broadest-to-narrowest scope order for the multi-role tier union
# (docs/MULTI-ROLE-TESTS.md §0): SELF < MANAGER < TEAM < DEPARTMENT <
# LOCATION < LEGAL_ENTITY < ALL. The ONLY new logic in multi-role RBAC is
# that the role layer takes the broadest tier across the user's ACTIVE
# roles; the override layer (always wins) and the baseline layer (SELF
# floor for employees) are unchanged from single-role.
_TIER_RANK = {
    ScopeTier.SELF: 0,
    ScopeTier.MANAGER: 1,
    ScopeTier.TEAM: 2,
    ScopeTier.DEPARTMENT: 3,
    ScopeTier.LOCATION: 4,
    ScopeTier.LEGAL_ENTITY: 5,
    ScopeTier.ALL: 6,
}


def _active_roles(user):
    """The user's roles that contribute grants (is_active=True). Prefetches
    when the caller already did; otherwise one small query."""
    return user.roles.filter(is_active=True)


def _role_grant_tiers(user, permission_code: str) -> list:
    """Scope tiers of every ACTIVE role of `user` granting `permission_code`."""
    return list(
        RolePermission.objects.filter(
            role__in=_active_roles(user),
            role__is_active=True,
            permission__code=permission_code,
        ).values_list("scope_tier", flat=True)
    )


def _has_employee_record(user) -> bool:
    return getattr(user, "employee", None) is not None


def user_has_permission(user, permission_code: str) -> bool:
    """Whether `user` holds `permission_code` at all, regardless of scope tier.
    For capability-style permissions that aren't employee-keyed (e.g.
    `roles.manage` — "can this user administer roles," not "which employees'
    roles can they see"). Employee-keyed permissions should still go through
    resolve_employee_scope() so the caller gets the actual filtered queryset,
    not just a yes/no."""
    scope_tier, is_granted = _resolve_effective_scope(user, permission_code)
    return bool(is_granted and scope_tier is not None)


def resolve_employee_scope(user, permission_code: str) -> QuerySet:
    """Returns the queryset of Employee rows `user` may act on for
    `permission_code`, resolved from their role's RolePermission (or a
    UserPermissionOverride on that exact user+permission, which always wins)."""
    scope_tier, is_granted = _resolve_effective_scope(user, permission_code)
    if not is_granted or scope_tier is None:
        return Employee.objects.none()

    # An ALL-tier grant covers every employee and never depends on the caller's
    # own record — an org-wide admin (e.g. the seeded superadmin) legitimately
    # has no Employee row of their own. Only the caller-relative tiers below
    # (self/manager/team/department/location/legal_entity) need one.
    if scope_tier == ScopeTier.ALL:
        return Employee.objects.all()

    employee = getattr(user, "employee", None)
    if employee is None:
        return Employee.objects.none()

    return _employees_for_tier(employee, scope_tier)


def _resolve_effective_scope(user, permission_code: str):
    """A UserPermissionOverride on this exact (user, permission) always wins over
    the roles' own grants — whether that means a wider scope, a narrower one, or
    an explicit denial (is_granted=False). Otherwise the effective tier is the
    BROADEST tier among the user's ACTIVE roles granting the code
    (docs/MULTI-ROLE-TESTS.md §0); inactive roles contribute nothing.

    Memoized on the `user` instance for the lifetime of the request: DRF's
    JWTAuthentication loads a fresh User instance per request (it isn't cached
    across requests), so attaching a plain dict here is request-scoped caching
    without needing an actual cache backend — the same permission code checked
    twice in one request (e.g. has_permission then has_object_permission) only
    hits the DB once."""
    cache = getattr(user, "_scope_resolution_cache", None)
    if cache is None:
        cache = {}
        user._scope_resolution_cache = cache
    if permission_code in cache:
        return cache[permission_code]

    override = (
        UserPermissionOverride.objects.select_related("permission")
        .filter(user=user, permission__code=permission_code)
        .first()
    )
    if override is not None:
        result = (override.scope_tier, override.is_granted)
        cache[permission_code] = result
        return result

    roles = getattr(user, "roles", None)
    if roles is None or not roles.exists():
        result = _baseline_or_deny(user, permission_code)
        cache[permission_code] = result
        return result

    tiers = _role_grant_tiers(user, permission_code)
    if tiers:
        result = (max(tiers, key=lambda t: _TIER_RANK[t]), True)
    else:
        result = _baseline_or_deny(user, permission_code)
    cache[permission_code] = result
    return result


def _baseline_or_deny(user, permission_code: str):
    """Fallback when neither an override nor the user's role grants the code:
    a self-service baseline permission is granted at SELF tier to anyone with an
    employee record; everything else is denied."""
    if permission_code in baseline_self_permissions() and _has_employee_record(user):
        return (ScopeTier.SELF, True)
    return (None, False)


def explain_permission(user, permission_code: str) -> dict:
    """Why `user` does or does not hold `permission_code`, for diagnostics and
    the access_matrix command. Reads the same data the resolver does, but never
    caches, so it reflects the database right now.

    Returns {"granted": bool, "tier": str | None,
             "source": "override" | "role" | "role (inactive)" | "none"}."""
    override = (
        UserPermissionOverride.objects.filter(user=user, permission__code=permission_code)
        .select_related("permission")
        .first()
    )
    if override is not None:
        return {
            "granted": override.is_granted,
            "tier": override.scope_tier if override.is_granted else None,
            "source": "override" if override.is_granted else "override (deny)",
        }
    baseline = {"granted": True, "tier": ScopeTier.SELF, "source": "baseline (employee)"}
    is_baseline = permission_code in baseline_self_permissions() and _has_employee_record(user)
    tiers = _role_grant_tiers(user, permission_code)
    if tiers:
        return {
            "granted": True,
            "tier": max(tiers, key=lambda t: _TIER_RANK[t]),
            "source": "role",
        }
    if is_baseline:
        return baseline
    _staff = (
        RolePermission.objects.filter(
            role__in=user.roles.all(),
            permission__code=permission_code,
        ).exists()
        if getattr(user, "roles", None) is not None
        else False
    )
    source = "role (inactive)" if _staff else "none"
    return {"granted": False, "tier": None, "source": source}


def user_effective_permissions(user) -> set:
    """The flat set of permission codes `user` holds at all, regardless of
    scope tier — the union across all ACTIVE roles' codes, plus granted
    overrides, plus the employee baseline, minus denied overrides
    (docs/MULTI-ROLE-TESTS.md §0).
    This is what `GET /users/me` reports as `permissions` (docs/IMPLEMENTATION-
    PLAN.md's contract); it is not scope-filtered because scope only matters
    once you're asking "on whom," not "can you at all.\" """
    roles = getattr(user, "roles", None)
    if roles is not None:
        # A deactivated role grants nothing (overrides below still apply).
        role_codes = set(
            RolePermission.objects.filter(
                role__in=roles.all(), role__is_active=True
            ).values_list("permission__code", flat=True)
        )
    else:
        role_codes = set()

    overrides = list(UserPermissionOverride.objects.filter(user=user).select_related("permission"))
    granted = {o.permission.code for o in overrides if o.is_granted}
    denied = {o.permission.code for o in overrides if not o.is_granted}

    # Every employee also holds the self-service baseline (see baseline_self_
    # permissions), unless an explicit override denies a specific one.
    baseline = set(baseline_self_permissions()) if _has_employee_record(user) else set()

    return (role_codes | granted | baseline) - denied


# Most-privileged-first rank for the deterministic primary archetype
# (docs/MULTI-ROLE-TESTS.md § "Primary role / archetype"). The RoleArchetype
# enum only knows employee/admin/superadmin, so the legacy starter names
# finance/manager slot in as tie-breaks between admin and plain employee.
_ARCHETYPE_RANK = {
    RoleArchetype.SUPERADMIN: 5,
    RoleArchetype.ADMIN: 4,
}


def _role_privilege_rank(role) -> int:
    rank = _ARCHETYPE_RANK.get(getattr(role, "archetype", None), 0)
    if rank:
        return rank
    name = (getattr(role, "name", "") or "").lower().replace(" ", "_")
    if name == "finance":
        return 3
    if name == "manager":
        return 2
    return 1


def primary_archetype(user) -> str:
    """One deterministic archetype for a multi-role user: the archetype of
    the most-privileged ACTIVE role (superadmin > admin > finance-name >
    manager-name > employee). Zero (active) roles → "employee" if the user
    has an employee record, else the account default ("employee")."""
    roles = getattr(user, "roles", None)
    best = None
    if roles is not None:
        for role in roles.filter(is_active=True):
            if best is None or _role_privilege_rank(role) > _role_privilege_rank(best):
                best = role
    if best is not None:
        return best.archetype
    return RoleArchetype.EMPLOYEE


def resolve_management_scope(user, permission_code: str = "employees.read") -> dict:
    """Coarse 3-way scope summary for the frontend's ManagementScope contract
    (frontend/src/lib/auth/auth-context.tsx: {kind:'self'} | {kind:'team',
    employeeIds} | {kind:'org'}) — the frontend only ever branches on this
    3-way distinction (see useRequireAccess's requireOrgScope), so our 7 tiers
    collapse: SELF -> self, ALL -> org, everything in between -> team with the
    actual resolved employee ids attached."""
    scope_tier, is_granted = _resolve_effective_scope(user, permission_code)
    if not is_granted or scope_tier is None or scope_tier == ScopeTier.SELF:
        return {"kind": "self"}
    # ALL is org-wide and independent of the caller's own record (an org-wide
    # admin need not be an employee); resolve it before requiring one.
    if scope_tier == ScopeTier.ALL:
        return {"kind": "org"}

    employee = getattr(user, "employee", None)
    if employee is None:
        return {"kind": "self"}

    ids = _employees_for_tier(employee, scope_tier).values_list("pk", flat=True)
    return {"kind": "team", "employeeIds": [str(pk) for pk in ids]}


def _employees_for_tier(employee: Employee, scope_tier: str) -> QuerySet:
    if scope_tier == ScopeTier.SELF:
        return Employee.objects.filter(pk=employee.pk)

    if scope_tier == ScopeTier.MANAGER:
        # Direct reports only, no recursion up or down — plus the caller's own
        # record, since every tier but SELF is inclusive of the caller.
        return Employee.objects.filter(Q(pk=employee.pk) | Q(manager_id=employee.pk))

    if scope_tier == ScopeTier.TEAM:
        subtree_ids = _recursive_subtree_ids(employee.pk)
        subtree_ids.add(employee.pk)
        return Employee.objects.filter(pk__in=subtree_ids)

    if scope_tier in _SCALAR_ATTRIBUTE_SCOPE_FIELDS:
        field = _SCALAR_ATTRIBUTE_SCOPE_FIELDS[scope_tier]
        value = getattr(employee, field)
        if value is None:
            return Employee.objects.filter(pk=employee.pk)
        return Employee.objects.filter(**{field: value})

    if scope_tier == ScopeTier.ALL:
        return Employee.objects.all()

    return Employee.objects.none()


# DEPARTMENT/LOCATION/LEGAL_ENTITY all resolve the same way: filter by a
# scalar FK on Employee, falling back to self-only if the employee has no
# value for that FK. A future scalar-attribute tier (e.g. cost center) is a
# one-line addition here, not a new copy-pasted branch.
_SCALAR_ATTRIBUTE_SCOPE_FIELDS = {
    ScopeTier.DEPARTMENT: "department_id",
    ScopeTier.LOCATION: "location_id",
    ScopeTier.LEGAL_ENTITY: "legal_entity_id",
}


def _recursive_subtree_ids(root_employee_id) -> set:
    """Every employee transitively under root_employee_id (direct + indirect
    reports), via a recursive CTE over the self-referencing manager FK — this is
    what backs the `team` tier and is the one piece of scope resolution that
    can't be expressed as a single Django ORM filter.

    Nothing elsewhere validates that Employee.manager assignments stay
    acyclic, so the CTE tracks the path it has walked and refuses to revisit
    a node already on it (`NOT e.id = ANY(s.path)`) — without this, a manager
    cycle in the data (however it got there) would make this query recurse
    without bound against the authorization path every employee-keyed
    request in the system depends on."""
    table = Employee._meta.db_table
    sql = f"""
        WITH RECURSIVE subtree AS (
            SELECT id, manager_id, ARRAY[id] AS path
            FROM {table} WHERE manager_id = %s
            UNION ALL
            SELECT e.id, e.manager_id, s.path || e.id
            FROM {table} e
            INNER JOIN subtree s ON e.manager_id = s.id
            WHERE NOT e.id = ANY(s.path)
        )
        SELECT id FROM subtree
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [root_employee_id])
        return {row[0] for row in cursor.fetchall()}


# ---------------------------------------------------------------------------
# Onboarding hybrid compatibility layer (additive only).
#
# The teammate's onboarding module was written against an older foundation API
# (`core.scope.is_hr_admin/is_finance/visible_employee_ids`). Our RBAC resolves
# scope through resolve_employee_scope() instead, so these thin shims translate
# his call sites onto it. None of the resolver logic above is modified.
# ---------------------------------------------------------------------------


def _normalized_role_names(user) -> set:
    """Role names in either convention: his lowercase ('hr_admin') and ours
    title-cased ('HR Admin'). Normalizing both lets one check serve both.
    Multi-role: the union across all of the user's roles."""
    roles = getattr(user, "roles", None)
    if roles is None:
        return set()
    return {
        (name or "").lower().replace(" ", "_")
        for name in roles.values_list("name", flat=True)
    }


def _normalized_role_name(user) -> str:
    """Legacy single-name form (kept for any caller expecting a string):
    one of the user's role names, or ""."""
    names = sorted(_normalized_role_names(user))
    return names[0] if names else ""


def is_it_admin(user) -> bool:
    """IT-admin check: holders of the IT Admin role may complete it_admin
    onboarding tasks and read the employee directory."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return "it_admin" in _normalized_role_names(user)


def is_hr_admin(user) -> bool:
    """HR-admin check for the onboarding module: superusers and holders of the
    HR Admin role (either naming convention) qualify. Deliberately name-based,
    matching the semantics his onboarding code was written against — a custom
    role holding a broad `employees.write` grant is NOT HR here."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return "hr_admin" in _normalized_role_names(user)


def is_finance(user) -> bool:
    """Finance check for the onboarding module: holders of the Finance role
    (either naming convention). HR Admin is intentionally NOT finance here —
    his call sites always test `is_hr_admin or is_finance` explicitly."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return "finance" in _normalized_role_names(user)


def visible_employee_ids(user, permission_code: str = "employees.read"):
    """Employee ids `user` may act on for `permission_code`, resolved through
    our RBAC scope resolver. Returns the values queryset (supports `in` and
    `__in` at his call sites, same as his implementation)."""
    return resolve_employee_scope(user, permission_code).values_list("id", flat=True)
