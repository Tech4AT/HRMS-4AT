"""Show how access is configured right now, and what it actually reaches.

    python manage.py access_matrix --roles                      # role x permission grid
    python manage.py access_matrix employees.read               # every person: tier, reach
    python manage.py access_matrix employees.read --user EMAIL  # the people one person can reach

The second form answers "does the org chart plus the scope tiers give each
person the reach I expect?" against real data. The third names exactly who one
person can reach, for spot checks ("does this manager see their whole team?").
Read-only; changes nothing.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Permission, Role, RolePermission
from core.scope import explain_permission, resolve_employee_scope
from employees.models import Employee

User = get_user_model()


def _name(employee):
    user = employee.user
    return f"{user.first_name} {user.last_name}".strip() or user.email


class Command(BaseCommand):
    help = "Show who holds a permission at which scope tier, and how many people that reaches."

    def add_arguments(self, parser):
        parser.add_argument("permission", nargs="?", help="Permission code, e.g. employees.read")
        parser.add_argument("--roles", action="store_true", help="Show the role x permission grid.")
        parser.add_argument("--user", metavar="EMAIL", help="List the people this user can reach.")

    def handle(self, *args, **options):
        code = options["permission"]
        if options["roles"]:
            return self._roles_grid()
        if not code:
            raise CommandError("Give a permission code (e.g. employees.read) or use --roles.")
        if not Permission.objects.filter(code=code).exists():
            known = ", ".join(Permission.objects.values_list("code", flat=True))
            raise CommandError(f"No such permission {code!r}. Known: {known}")
        if options["user"]:
            return self._one_user(code, options["user"])
        return self._everyone(code)

    def _roles_grid(self):
        permissions = list(Permission.objects.order_by("code"))
        width = max([len(p.code) for p in permissions] + [10])
        header = f"{'role':<24}{'users':>6}  " + "  ".join(
            f"{p.code:<{width}}" for p in permissions
        )
        self.stdout.write(header)
        self.stdout.write("-" * len(header))
        grants = {(g.role_id, g.permission_id): g.scope_tier for g in RolePermission.objects.all()}
        for role in Role.objects.order_by("name"):
            label = role.name + ("" if role.is_active else " (inactive)")
            cells = [f"{grants.get((role.pk, p.pk), '-'):<{width}}" for p in permissions]
            self.stdout.write(f"{label:<24}{role.users.count():>6}  " + "  ".join(cells))

    def _everyone(self, code):
        total = Employee.objects.count()
        self.stdout.write(
            f"Reach of {code} for every person ({total} employees in the directory)\n"
        )
        self.stdout.write(f"{'person':<32}{'role':<20}{'source':<16}{'tier':<14}reach")
        self.stdout.write("-" * 96)
        rows = []
        for employee in Employee.objects.select_related("user").prefetch_related(
            "user__roles"
        ).order_by("user__last_name"):
            user = employee.user
            info = explain_permission(user, code)
            reach = resolve_employee_scope(user, code).count() if info["granted"] else 0
            names = ", ".join(user.roles.order_by("name").values_list("name", flat=True))
            rows.append((_name(employee), names or "-", info, reach))
        for name, role, info, reach in sorted(rows, key=lambda r: (-r[3], r[0])):
            tier = info["tier"] or "-"
            self.stdout.write(
                f"{name[:31]:<32}{role[:19]:<20}{info['source']:<16}{tier:<14}{reach}"
            )
        by_tier = {}
        for _n, _r, info, _c in rows:
            by_tier[info["tier"] or "no access"] = by_tier.get(info["tier"] or "no access", 0) + 1
        self.stdout.write(
            "\nPeople by tier: " + ", ".join(f"{k}: {v}" for k, v in sorted(by_tier.items()))
        )

    def _one_user(self, code, email):
        try:
            user = User.objects.prefetch_related("roles").get(email__iexact=email)
        except User.DoesNotExist:
            raise CommandError(f"No user with email {email!r}.") from None
        info = explain_permission(user, code)
        role = ", ".join(user.roles.order_by("name").values_list("name", flat=True)) or "no role"
        self.stdout.write(f"{user.get_full_name() or user.email}  ({role})")
        self.stdout.write(
            f"{code}: {'granted' if info['granted'] else 'NOT granted'} "
            f"via {info['source']}, tier {info['tier'] or '-'}\n"
        )
        reach = resolve_employee_scope(user, code).select_related("user", "manager__user")
        self.stdout.write(f"Can reach {reach.count()} of {Employee.objects.count()} employees:")
        for employee in reach.order_by("user__last_name", "user__first_name"):
            boss = f"  (reports to {_name(employee.manager)})" if employee.manager_id else ""
            self.stdout.write(f"  {_name(employee)}{boss}")
