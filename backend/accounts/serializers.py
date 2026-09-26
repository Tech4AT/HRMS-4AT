from rest_framework import serializers

from accounts.models import Permission, Role, RolePermission, User, UserPermissionOverride


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "code", "label", "description", "group"]


class RolePermissionSerializer(serializers.ModelSerializer):
    permission_code = serializers.CharField(source="permission.code", read_only=True)

    class Meta:
        model = RolePermission
        fields = ["id", "role", "permission", "permission_code", "scope_tier", "created_at"]
        read_only_fields = ["id", "created_at"]


class RoleSerializer(serializers.ModelSerializer):
    """`permissions` is a read-only nested view of this role's RolePermission
    rows — granting/revoking a permission on a role goes through the dedicated
    /role-permissions/ endpoint, not by PATCHing this nested list, so each write
    is one unambiguous row-level change (and one clean audit entry, since
    RoleViewSet is an AuditedModelViewSet)."""

    permissions = RolePermissionSerializer(source="role_permissions", many=True, read_only=True)
    user_count = serializers.SerializerMethodField()

    def get_user_count(self, obj):
        return obj.users.count()

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "description",
            "archetype",
            "is_active",
            "user_count",
            "permissions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user_count", "permissions", "created_at", "updated_at"]


class UserPermissionOverrideSerializer(serializers.ModelSerializer):
    permission_code = serializers.CharField(source="permission.code", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.email

    class Meta:
        model = UserPermissionOverride
        fields = [
            "id",
            "user",
            "user_email",
            "user_name",
            "permission",
            "permission_code",
            "scope_tier",
            "is_granted",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False, write_only=True)
    new_password = serializers.CharField(trim_whitespace=False, write_only=True)


class AuthUserSerializer(serializers.ModelSerializer):
    """The `user` object nested in the login response
    (docs/IMPLEMENTATION-PLAN.md): id as a string, matching the frontend's
    `User.id: string` (frontend/src/lib/auth/auth-context.tsx) even though
    the DB pk is numeric."""

    id = serializers.SerializerMethodField()
    # Rendered as `mustChangePassword` by the CamelCaseJSONRenderer — the
    # frontend's forced-password-change gate reads it from login and /me.
    must_change_password = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "must_change_password"]

    def get_id(self, obj):
        return str(obj.pk)


class MeUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["first_name", "last_name"]


class UserSerializer(serializers.ModelSerializer):
    """For UserViewSet (accounts/views.py) — user administration, primarily
    role assignment. `role` is the only writable field; email/username/names
    stay read-only here (they're set at provisioning time, not through this
    endpoint)."""

    role_name = serializers.CharField(source="role.name", read_only=True, default=None)
    employee_code = serializers.CharField(
        source="employee.employee_code", read_only=True, default=None
    )

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "role",
            "role_name",
            "employee_code",
            "is_active",
        ]
        read_only_fields = ["id", "email", "first_name", "last_name", "role_name", "employee_code"]
