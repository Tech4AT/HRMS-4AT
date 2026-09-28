from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from accounts.models import Permission, Role, RolePermission, User, UserPermissionOverride


class RolePermissionInline(admin.TabularInline):
    model = RolePermission
    extra = 1


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["name", "archetype", "is_active"]
    inlines = [RolePermissionInline]


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ["code", "description"]
    search_fields = ["code"]


@admin.register(UserPermissionOverride)
class UserPermissionOverrideAdmin(admin.ModelAdmin):
    list_display = ["user", "permission", "scope_tier", "is_granted", "created_by"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (("HRMS", {"fields": ("roles",)}),)
    list_display = (*BaseUserAdmin.list_display, "role_names")
    filter_horizontal = ("roles",)

    def role_names(self, obj):
        return ", ".join(obj.roles.order_by("name").values_list("name", flat=True))

    role_names.short_description = "Roles"
