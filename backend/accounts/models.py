"""Primitive #2 — RBAC + scope resolver. See docs/ARCHITECTURE.md primitive 2 and
docs/REQUIREMENTS.md §0 for the product-level design this implements.

Roles are admin-creatable, not a fixed set (P1-E1-12 wires CRUD on top of these
models). Permission *codes* are still declared in code by whichever module owns
that action; what's admin-configurable is which role/individual holds which code,
at what scope tier. Scope itself is resolved by core.scope.resolve_employee_scope,
not by anything in this module — these models only store the assignment.
"""

import hashlib
import secrets

from django.conf import settings
from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models
from django.utils import timezone

from core.enums import RoleArchetype, ScopeTier


# ---------------------------------------------------------------------------
# Onboarding hybrid compatibility layer (additive only).
#
# The teammate's onboarding module was written against an older accounts API:
# lowercase ROLE_* name constants and a `permissions` JSONField default on
# Role.get_or_create, plus a password-setup token helper. Our RBAC stores
# grants in RolePermission rows (not on Role) and requires an archetype per
# role, so this layer translates his call sites onto our models. Nothing
# above is modified.
# ---------------------------------------------------------------------------

ROLE_HR_ADMIN = "hr_admin"
ROLE_FINANCE = "finance"
ROLE_MANAGER = "manager"
ROLE_EMPLOYEE = "employee"
ROLE_IT_ADMIN = "it_admin"

# Which UI archetype a legacy lowercase role name maps to when it is created
# through the compat manager below (mirrors the starter-role assignment in
# accounts/migrations/0002_seed_starter_roles.py).
_LEGACY_ROLE_ARCHETYPES = {
    ROLE_HR_ADMIN: RoleArchetype.SUPERADMIN,
    ROLE_FINANCE: RoleArchetype.ADMIN,
    ROLE_MANAGER: RoleArchetype.EMPLOYEE,
    ROLE_EMPLOYEE: RoleArchetype.EMPLOYEE,
    ROLE_IT_ADMIN: RoleArchetype.ADMIN,
}


class RoleManager(models.Manager):
    """Accepts the legacy `permissions=[...]` create-default his onboarding
    code passes to Role.objects.get_or_create. Our grants live in
    RolePermission rows (a flat string carries no scope tier, so it cannot be
    translated faithfully) — the legacy list is therefore dropped and only
    the role name is honored; his call sites gate on role names, not on the
    contents of that list. Also supplies a sensible archetype default so the
    legacy call (which never passes one) satisfies our non-nullable field."""

    def get_or_create(self, *args, **kwargs):
        defaults = kwargs.get("defaults", {})
        if "permissions" in defaults:
            defaults = {k: v for k, v in defaults.items() if k != "permissions"}
            kwargs["defaults"] = defaults
        name = kwargs.get("name") or defaults.get("name", "")
        if "archetype" not in defaults:
            defaults["archetype"] = _LEGACY_ROLE_ARCHETYPES.get(
                (name or "").lower(), RoleArchetype.EMPLOYEE
            )
        return super().get_or_create(*args, **kwargs)


class Role(models.Model):
    """Admin-creatable. The 4 starter roles (Employee/Manager/HR Admin/Finance)
    are seeded defaults, not a hardcoded ceiling — see docs/REQUIREMENTS.md §0."""

    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)
    archetype = models.CharField(
        max_length=20,
        choices=RoleArchetype.choices,
        help_text=(
            "Which of the frontend's 3 known UI archetypes this role renders as "
            "(employee/admin/superadmin — see core.enums.RoleArchetype for why "
            "not 4). The frontend is unmodified and only understands these 3 "
            "(docs/TASKS.md P1-E3-01) so every role — starter or custom — must "
            "declare one, even a brand-new custom role."
        ),
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    objects = RoleManager()


class Permission(models.Model):
    """Enumerated permission strings in dot-notation (leave.approve,
    expense.write, ...). Declared by the module that owns the action being
    gated — not admin-creatable through any UI. `label` is the short row text
    in the role UI; `group` is the feature area it is listed under. Both are
    synced from the module's `rbac.py` (blank values are filled, edited ones
    are kept — same rule as `description`)."""

    code = models.CharField(max_length=150, unique=True)
    description = models.CharField(max_length=255, blank=True)
    label = models.CharField(max_length=120, blank=True)
    group = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return self.code


class RolePermission(models.Model):
    """(role, permission) -> scope tier. Scope is set per permission per role,
    not once per role — the same role can hold one permission at Team scope and
    another at Department scope."""

    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, related_name="role_permissions"
    )
    scope_tier = models.CharField(max_length=20, choices=ScopeTier.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["role", "permission"], name="unique_role_permission")
        ]
        ordering = ["role__name", "permission__code"]

    def __str__(self):
        return f"{self.role.name}: {self.permission.code} @ {self.scope_tier}"


class CompatUserManager(UserManager):
    """Same as Django's UserManager, except `username` defaults to the email
    address when the caller does not pass one. The teammate's onboarding code
    creates users with `create_user(email=..., ...)` and no username (his
    foundation logs in by email); our login likewise looks users up by email,
    so defaulting the legacy username column to the email keeps both paths
    working. Callers that pass an explicit username see zero behavior change."""

    def create_user(self, username=None, email=None, password=None, **extra_fields):
        if not username:
            username = self.normalize_email(email or "")
        return super().create_user(username, email, password, **extra_fields)

    def create_superuser(self, username=None, email=None, password=None, **extra_fields):
        if not username:
            username = self.normalize_email(email or "")
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """Single role per user via a direct FK (a DB constraint, not a convention) —
    see docs/ARCHITECTURE.md primitive 2 for why this isn't M2M. Per-individual
    customization goes through UserPermissionOverride below, not multiple roles.

    `email` is overridden unique — the frontend contract logs in with
    `{email, password}` (frontend/src/app/api/auth/login/route.ts), so the
    login view looks users up by email directly rather than through
    AbstractUser's non-unique default."""

    email = models.EmailField(unique=True)
    role = models.ForeignKey(
        Role, null=True, blank=True, on_delete=models.PROTECT, related_name="users"
    )
    must_change_password = models.BooleanField(
        default=False,
        help_text="True when an admin has issued a temporary password: "
        "the user must change it (POST users/me/change-password) before "
        "using the app.",
    )

    def __str__(self):
        return self.get_username()

    objects = CompatUserManager()


class UserPermissionOverride(models.Model):
    """Per-individual grant or restriction on top of the user's role. An override
    on a given (user, permission) always wins over that role's own RolePermission
    row, whether it widens access (is_granted=True at a broader tier) or narrows
    it (is_granted=False denies the permission outright for this one person)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="permission_overrides")
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, related_name="user_overrides"
    )
    scope_tier = models.CharField(max_length=20, choices=ScopeTier.choices)
    is_granted = models.BooleanField(
        default=True,
        help_text="False explicitly denies this permission for this user, "
        "overriding what their role would otherwise give them.",
    )
    created_by = models.ForeignKey(
        User,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_permission_overrides",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "permission"], name="unique_user_permission_override"
            )
        ]
        ordering = ["user__username", "permission__code"]

    def __str__(self):
        verb = "grant" if self.is_granted else "deny"
        return f"{self.user}: {verb} {self.permission.code} @ {self.scope_tier}"


class FailedLoginAttempt(models.Model):
    """Tracked per account, not per IP — that's the login throttle's job
    (config.settings.base's DEFAULT_THROTTLE_RATES['login']), a different
    defense against a different attack (one IP hammering many accounts vs.
    many attempts against one account). LoginView checks the count within the
    trailing LOCKOUT_WINDOW before authenticating; see accounts/auth_views.py."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="failed_login_attempts")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "created_at"])]


class PasswordSetupToken(models.Model):
    """One-time set-password link for accounts created by the onboarding flow
    (additive model for the onboarding hybrid layer — no existing table is
    touched). Only the SHA-256 hash is persisted; the raw token is shown once
    in the welcome email, same pattern as the offer-letter signing token."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_setup_tokens"
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_valid(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_password_setup_token(user, *, ttl_hours: int = 72) -> str:
    """Creates a PasswordSetupToken and returns the raw (unhashed) token.
    Reissuing invalidates any previous still-valid token for this user, so
    only the most recently issued link ever works."""
    PasswordSetupToken.objects.filter(user=user, used_at__isnull=True).update(
        used_at=timezone.now()
    )
    raw = secrets.token_urlsafe(32)
    PasswordSetupToken.objects.create(
        user=user,
        token_hash=_hash_token(raw),
        expires_at=timezone.now() + timezone.timedelta(hours=ttl_hours),
    )
    return raw


def consume_password_setup_token(raw: str):
    """Returns the valid token for `raw`, or None when unknown/expired/used."""
    token = (
        PasswordSetupToken.objects.filter(token_hash=_hash_token(raw))
        .select_related("user")
        .first()
    )
    if token is None or not token.is_valid:
        return None
    return token
