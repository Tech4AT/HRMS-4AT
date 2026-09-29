"""Load the real employee roster from the HR export xlsx.

Wipes existing employees/users/org structure, then loads people, departments,
locations and the reporting hierarchy from the sheet — resolving the common
case where the "Reporting Manager" column spells a name differently from that
person's own row (first name + surname-prefix match). Also provisions a
superadmin plus a few real demo logins so the app is usable immediately.

The xlsx is real PII and gitignored; pass its path (default: the DIRECTORY_XLSX
env var, else /data/roster.xlsx, which docker-compose mounts read-only).
Re-runnable: it wipes first.
"""

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, User
from employees.models import (
    BusinessUnit,
    CostCenter,
    Department,
    Employee,
    JobTitle,
    Location,
    Position,
    Team,
)
from employees.org_seed import seed_derived_org_masters, seed_keka_org_details

DEMO_PW = "Welcome@123"
ADMIN_EMAIL = "admin@hrms.local"
ADMIN_PW = "Admin12345!"

# Manager names in the sheet that don't overlap the person's own name row at all.
# Map the "Reporting Manager" spelling -> that employee's full name (lowercased).
MANAGER_ALIASES = {
    "sidhardha nvn": "venkata naga sidhardha nallamalli",
}


def _is_junk(empno, first):
    empno_l, first_l = empno.lower(), first.lower()
    return (
        not empno
        or " " in empno
        or "generated" in empno_l
        or empno == "00000"
        or "this report" in first_l
        or first_l == "test"
    )


class Command(BaseCommand):
    help = "Wipe demo data and load the real employee directory from the HR xlsx."

    def add_arguments(self, parser):
        parser.add_argument(
            "xlsx",
            nargs="?",
            default=os.environ.get("DIRECTORY_XLSX", "/data/roster.xlsx"),
            help="Path to the HR export .xlsx",
        )

    def handle(self, *args, **opts):
        path = opts["xlsx"]
        if not os.path.exists(path):
            raise CommandError(f"xlsx not found: {path}")
        try:
            import openpyxl
        except ImportError as e:
            raise CommandError("openpyxl is required (pip install openpyxl)") from e

        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        header = next(r for r in rows if r and "Employee Number" in [str(c).strip() for c in r if c])
        col = {str(h).strip(): i for i, h in enumerate(header) if h}

        def g(row, name):
            i = col.get(name)
            v = row[i] if i is not None and i < len(row) else None
            return ("" if v is None else str(v)).strip()

        data = [r for r in rows[rows.index(header) + 1 :] if r and not _is_junk(g(r, "Employee Number"), g(r, "First Name"))]

        with transaction.atomic():
            Employee.objects.all().delete()
            User.objects.all().delete()
            # Derived masters are rebuilt from the fresh directory below, so
            # wipe them here (employees are already gone, satisfying the
            # PROTECT links; Team.department is PROTECT, hence before deps).
            Team.objects.all().delete()
            Position.objects.all().delete()
            BusinessUnit.objects.all().delete()
            CostCenter.objects.all().delete()
            # Break self-referential parent links before deleting (parent FK is PROTECT).
            Department.objects.update(parent=None)
            Department.objects.all().delete()
            JobTitle.objects.all().delete()
            Location.objects.all().delete()

            dep, des, loc = {}, {}, {}

            def simple(cache, model, name):
                name = name or "Unspecified"
                if name not in cache:
                    cache[name], _ = model.objects.get_or_create(name=name)
                return cache[name]

            def department(parent_name, child_name):
                parent = simple(dep, Department, parent_name or "Unassigned")
                if not child_name or child_name == parent_name:
                    return parent
                key = f"{parent_name} > {child_name}"
                if key not in dep:
                    child, _ = Department.objects.get_or_create(name=child_name, defaults={"parent": parent})
                    if child.parent_id != parent.id:
                        child.parent = parent
                        child.save()
                    dep[key] = child
                return dep[key]

            rm_of = {}
            for r in data:
                empno = g(r, "Employee Number")
                first = g(r, "First Name") or g(r, "Full Name").split(" ")[0]
                last = g(r, "Last Name")
                email = f"{empno.lower()}@consult-4at.com"
                exited = g(r, "Exit Status").lower() not in ("", "none", "no")
                u = User(email=email, username=email, first_name=first, last_name=last)
                u.set_unusable_password()
                u.save()
                Employee.objects.create(
                    user=u, employee_code=empno,
                    department=department(g(r, "Department"), g(r, "Sub Department")),
                    designation=simple(des, JobTitle, g(r, "Job Title")),
                    location=simple(loc, Location, g(r, "Location")),
                    status="exited" if exited else "active",
                )
                rm = g(r, "Reporting Manager")
                if rm:
                    rm_of[empno] = rm

            emps = list(Employee.objects.select_related("user").all())

            def fn(e):
                return (e.user.first_name or e.user.get_full_name().split()[0]).strip().lower()

            def ln(e):
                return (e.user.last_name or e.user.get_full_name().split()[-1]).strip().lower()

            exact = {e.user.get_full_name().strip().lower(): e for e in emps}

            def match(rm):
                key = rm.strip().lower()
                key = MANAGER_ALIASES.get(key, key)
                if key in exact:
                    return exact[key]
                t = [x for x in key.split() if x]
                if not t:
                    return None
                # order-independent: one name's tokens are a subset of the other's
                # (handles surname-first manager names and middle names)
                rmset = set(t)
                for e in emps:
                    es = set(e.user.get_full_name().lower().split())
                    if es and (es <= rmset or rmset <= es):
                        return e
                # fall back to first-name + surname-prefix
                cands = [e for e in emps if fn(e) == t[0]]
                for e in cands:
                    el = ln(e)
                    if el == t[-1] or el.startswith(t[-1]) or t[-1].startswith(el) or el in t:
                        return e
                return cands[0] if len(cands) == 1 else None

            linked = 0
            for e in emps:
                m = match(rm_of.get(e.employee_code, ""))
                if m and m.pk != e.pk:
                    e.manager = m
                    e.save()
                    linked += 1

            # --- provisioning: superadmin + a few real demo logins with roles ---
            roles = {r.name: r for r in Role.objects.all()}
            admin = User(email=ADMIN_EMAIL, username=ADMIN_EMAIL, first_name="Admin",
                         last_name="", is_staff=True, is_superuser=True)
            admin.set_password(ADMIN_PW)
            admin.save()
            admin.roles.add(roles.get("HR Admin"))
            logins = [(ADMIN_EMAIL, ADMIN_PW, "HR Admin (superuser)")]

            def give(emp, role_name):
                if not emp:
                    return
                u = emp.user
                u.set_password(DEMO_PW)
                u.save()
                u.roles.add(roles.get(role_name))
                logins.append((u.email, DEMO_PW, f"{role_name} — {u.get_full_name()}"))

            # EXPLICIT demo logins by email (durable: this command re-runs on
            # every backend boot, so role holders must be pinned here, not just
            # in the DB). Nobody else gets a demo password or a role, so only
            # admin + these 4 can log in. Everyone else stays in the directory
            # with an unusable password and no roles.
            DEMO_LOGINS = [
                ("4at0111@consult-4at.com", "HR Admin"),
                ("4at0181@consult-4at.com", "Employee"),
                ("4at0187@consult-4at.com", "Manager"),
                ("4at0070@consult-4at.com", "Finance"),
            ]
            by_email = {e.user.email.lower(): e for e in emps}
            for email, role_name in DEMO_LOGINS:
                emp = by_email.get(email.lower())
                if emp is None:
                    self.stdout.write(f"  WARNING: demo login email not found: {email}")
                    continue
                give(emp, role_name)

            # Derived org masters (BusinessUnit/CostCenter/Team/Position) from
            # the real directory just loaded — idempotent, so every boot
            # rebuilds them identically after the wipe above.
            seed_counts = seed_derived_org_masters()
            keka_counts = seed_keka_org_details()

        self.stdout.write(self.style.SUCCESS(
            f"Loaded {len(emps)} employees, {linked} manager links. "
            f"Derived masters: {seed_counts}. Keka details: {keka_counts}. Logins:"))
        for em, pw, note in logins:
            self.stdout.write(f"  {em} / {pw}   [{note}]")
