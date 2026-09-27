"""Multi-role RBAC: replace User.role FK with User.roles M2M
(docs/MULTI-ROLE-TESTS.md §G).

Each existing user's single role becomes exactly one M2M membership; a null
role becomes zero memberships — so effective access is identical before and
after (test G2 pins this). Additive: no table is dropped with data still in
it (the memberships are copied first, then the FK column goes away).

The "role delete stays blocked while held" guard lives in
RoleViewSet.perform_destroy (accounts/views.py), not in the DB constraint,
so it survives the FK removal unchanged.
"""

from django.db import migrations, models


def copy_fk_to_m2m(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    through = User.roles.through
    rows = [
        through(user_id=user_id, role_id=role_id)
        for user_id, role_id in User.objects.exclude(role_id=None).values_list("id", "role_id")
    ]
    through.objects.bulk_create(rows, ignore_conflicts=True)


def copy_m2m_to_fk(apps, schema_editor):
    """Reverse: restore the FK from the memberships (lowest role id wins for
    users holding several — reverse migrations are best-effort)."""
    User = apps.get_model("accounts", "User")
    through = User.roles.through
    first_role = {}
    for user_id, role_id in through.objects.order_by("user_id", "role_id").values_list(
        "user_id", "role_id"
    ):
        first_role.setdefault(user_id, role_id)
    for user in User.objects.all().only("id"):
        user.role_id = first_role.get(user.pk)
        user.save(update_fields=["role"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0013_permission_label_group")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="roles",
            field=models.ManyToManyField(
                blank=True,
                help_text=(
                    "Roles this user holds. Effective access is the union across "
                    "active roles (broadest scope tier wins); see "
                    "core.scope._resolve_effective_scope."
                ),
                related_name="users",
                to="accounts.role",
            ),
        ),
        migrations.RunPython(copy_fk_to_m2m, copy_m2m_to_fk),
        migrations.RemoveField(model_name="user", name="role"),
    ]
