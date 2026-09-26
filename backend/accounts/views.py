"""RBAC management — docs/TASKS.md P1-E1-12 (Role/RolePermission CRUD),
P1-E1-13 (UserPermissionOverride CRUD), and P1-E4-03 (admin-driven password
reset). Everything here is gated behind `roles.manage`, a flat capability
permission (not employee-keyed), via HasPermissionCode, and every mutation
goes through AuditedModelViewSet (audit/mixins.py) so it lands in the audit
log — no exceptions, per docs/REQUIREMENTS.md's "audit everything.\" """

import secrets

from django.db.models import Q
from djangorestframework_camel_case.util import camelize
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import Permission, Role, RolePermission, User, UserPermissionOverride
from accounts.serializers import (
    PermissionSerializer,
    RolePermissionSerializer,
    RoleSerializer,
    UserPermissionOverrideSerializer,
    UserSerializer,
)
from accounts.services import revoke_all_sessions
from audit.mixins import AuditedModelViewSet
from audit.service import write_audit
from core.exceptions import Conflict
from core.permissions import HasPermissionCode
from core.scope import explain_permission, resolve_employee_scope
from employees.models import Employee


class RoleViewSet(AuditedModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "roles.manage"
    audit_entity_type = "Role"

    def perform_destroy(self, instance):
        holders = instance.users.count()
        if holders:
            who = "person holds" if holders == 1 else "people hold"
            raise Conflict(
                f"{holders} {who} the role '{instance.name}'. "
                "Move them to another role first, or deactivate the role instead of deleting it."
            )
        super().perform_destroy(instance)


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only — permission codes are declared in code by whichever module
    owns the action, not admin-creatable (docs/REQUIREMENTS.md §0). This
    endpoint exists so a role-management UI can list what's available to
    assign. Only permissions of built (`enabled`) modules are listed — a
    reference or not-yet-enforcing module's codes stay out until it ships."""

    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "roles.manage"

    def get_queryset(self):
        from core.registry import enabled_permission_codes

        return super().get_queryset().filter(code__in=enabled_permission_codes())


class RolePermissionViewSet(AuditedModelViewSet):
    """Grants (or changes the scope tier of) one permission on one role.
    ?role=<id> filters to a single role's grants, e.g. for a role-edit screen."""

    queryset = RolePermission.objects.select_related("role", "permission").all()
    serializer_class = RolePermissionSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "roles.manage"
    audit_entity_type = "RolePermission"

    def get_queryset(self):
        queryset = super().get_queryset()
        role_id = self.request.query_params.get("role")
        if role_id:
            queryset = queryset.filter(role_id=role_id)
        return queryset


class UserPermissionOverrideViewSet(AuditedModelViewSet):
    """Per-individual grant/restriction beyond a user's role
    (docs/REQUIREMENTS.md §0). ?user=<id> filters to one person's overrides;
    ?permission=<id> filters to everyone mapped to one permission."""

    queryset = UserPermissionOverride.objects.select_related("user", "permission").all()
    serializer_class = UserPermissionOverrideSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "roles.manage"
    audit_entity_type = "UserPermissionOverride"

    def get_queryset(self):
        queryset = super().get_queryset()
        user_id = self.request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        permission_id = self.request.query_params.get("permission")
        if permission_id:
            queryset = queryset.filter(permission_id=permission_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
        write_audit(
            self.request.user,
            "UserPermissionOverride.created",
            "UserPermissionOverride",
            serializer.instance.pk,
            {"after": camelize(serializer.data)},
        )


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """User administration — primarily role assignment (docs/REQUIREMENTS.md
    §0: a user has exactly one Role, assigned here) and admin-driven password
    reset (P1-E4-03: the fallback that works regardless of the still-open
    SSO-vs-password question). Deliberately narrow: UserSerializer exposes
    `role` and `is_active` as the only writable fields — no email/username/
    password changes through this endpoint. `?search=` filters by name/email
    for an admin picking a user to act on.

    Deliberately list/retrieve/update only — no create, no destroy. User
    creation belongs to `import_employee_directory`/`createinitialadmin`
    (UserSerializer's email/name fields are read-only here, so a POST
    couldn't produce a valid account anyway), and hard-deleting a User
    cascades to their linked Employee record — too destructive for this
    narrow admin surface, and previously went entirely unaudited since
    plain ModelViewSet's create/destroy don't call perform_update."""

    queryset = User.objects.select_related("role").order_by("email")
    serializer_class = UserSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "roles.manage"

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
            )
        return queryset

    def _refuse_self_lockout(self, serializer):
        """An administrator may not change their own role or deactivate their own
        account here: one slip would remove the only person able to fix it. Another
        administrator does it instead."""
        instance = serializer.instance
        if instance.pk != self.request.user.pk:
            return
        data = serializer.validated_data
        changing_role = "role" in data and data["role"] != instance.role
        deactivating = data.get("is_active") is False
        if changing_role or deactivating:
            raise PermissionDenied(
                "You cannot change your own role or deactivate your own account. "
                "Ask another administrator."
            )

    def perform_update(self, serializer):
        self._refuse_self_lockout(serializer)
        before_role = serializer.instance.role
        before_active = serializer.instance.is_active
        serializer.save()
        after_role = serializer.instance.role
        after_active = serializer.instance.is_active

        # Two independent checks, not one blanket "something changed" log —
        # a PATCH that only flips is_active must never be recorded as a
        # role_changed event with identical before/after role values; that
        # would make an access-revocation incident invisible to review.
        before_role_id = before_role.id if before_role else None
        after_role_id = after_role.id if after_role else None
        if before_role_id != after_role_id:
            write_audit(
                self.request.user,
                "User.role_changed",
                "User",
                serializer.instance.pk,
                {
                    "before": {"role": before_role.name if before_role else None},
                    "after": {"role": after_role.name if after_role else None},
                },
            )

        if before_active != after_active:
            write_audit(
                self.request.user,
                "User.active_status_changed",
                "User",
                serializer.instance.pk,
                {"before": {"isActive": before_active}, "after": {"isActive": after_active}},
            )

    @action(detail=True, methods=["get"], url_path="access-preview")
    def access_preview(self, request, pk=None):
        """What this person can actually reach for one permission, right now:
        where the access comes from (their role, a personal exception, or
        nothing), at what level, and exactly which people that covers. Lets an
        admin check a setting before or after changing it."""
        user = self.get_object()
        code = request.query_params.get("permission", "employees.read")
        if not Permission.objects.filter(code=code).exists():
            raise ValidationError({"permission": ["Unknown permission."]})

        info = explain_permission(user, code)
        reach = resolve_employee_scope(user, code) if info["granted"] else Employee.objects.none()
        count = reach.count()
        limit = 200
        people = [
            {
                "id": str(e.pk),
                "name": e.user.get_full_name() or e.user.email,
                "employeeCode": e.employee_code,
            }
            for e in reach.select_related("user").order_by("user__last_name", "user__first_name")[
                :limit
            ]
        ]
        return Response(
            {
                "success": True,
                "data": {
                    "permission": code,
                    "granted": info["granted"],
                    "tier": info["tier"],
                    "source": info["source"],
                    "reachCount": count,
                    "totalEmployees": Employee.objects.count(),
                    "people": people,
                    "truncated": count > limit,
                },
            }
        )

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """Sets a fresh random password and returns it once — the caller
        (an HR Admin, per docs) is responsible for relaying it to the
        employee out of band. There's no self-service reset yet (blocked on
        the open SSO-vs-passwords question, docs/REQUIREMENTS.md's open
        questions) so this is the fallback that works regardless of how
        that's eventually resolved."""
        user = self.get_object()
        new_password = secrets.token_urlsafe(12)
        user.set_password(new_password)
        user.must_change_password = True
        user.save(update_fields=["password", "must_change_password"])

        write_audit(request.user, "User.password_reset", "User", user.pk)
        return Response({"success": True, "data": {"temporaryPassword": new_password}})

    @action(detail=True, methods=["post"], url_path="revoke-sessions")
    def revoke_sessions(self, request, pk=None):
        """Admin force-logout: blacklists every outstanding refresh token for
        this user, ending all of their active sessions everywhere. Distinct
        from MySessionDetailView (accounts/session_views.py), which only ever
        lets a user revoke their own session."""
        user = self.get_object()
        revoked_count = revoke_all_sessions(user)

        write_audit(
            request.user, "User.sessions_revoked", "User", user.pk, {"revokedCount": revoked_count}
        )
        return Response({"success": True, "data": {"revokedCount": revoked_count}})
