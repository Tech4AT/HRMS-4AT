import factory

from accounts.models import Permission, Role, RolePermission, User, UserPermissionOverride
from core.enums import RoleArchetype, ScopeTier


class RoleFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Role
        django_get_or_create = ("name",)

    name = factory.Sequence(lambda n: f"Role {n}")
    archetype = RoleArchetype.EMPLOYEE


class PermissionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Permission
        django_get_or_create = ("code",)

    code = factory.Sequence(lambda n: f"test.permission.{n}")


class RolePermissionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = RolePermission

    role = factory.SubFactory(RoleFactory)
    permission = factory.SubFactory(PermissionFactory)
    scope_tier = ScopeTier.SELF


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("username",)
        skip_postgeneration_save = True

    username = factory.Sequence(lambda n: f"user{n}")
    email = factory.Sequence(lambda n: f"user{n}@example.com")

    @factory.post_generation
    def role(obj, create, extracted, **kwargs):
        """Legacy single-role hook: UserFactory(role=R) holds exactly R;
        UserFactory(role=None) holds nothing. (No `role` argument at all
        also holds nothing — an empty starter role grants nothing anyway,
        so the old implicit empty role is behaviour-identical.)"""
        if not create or extracted is None:
            return
        obj.roles.add(extracted)

    @factory.post_generation
    def roles(obj, create, extracted, **kwargs):
        """Multi-role hook: UserFactory(roles=[R1, R2]) holds both."""
        if not create or not extracted:
            return
        obj.roles.add(*extracted)


class UserPermissionOverrideFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = UserPermissionOverride

    user = factory.SubFactory(UserFactory)
    permission = factory.SubFactory(PermissionFactory)
    scope_tier = ScopeTier.SELF
    is_granted = True
