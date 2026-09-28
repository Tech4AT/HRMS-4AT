# Backend

Django + DRF backend described in
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and
[`../docs/IMPLEMENTATION-PLAN.md`](../docs/IMPLEMENTATION-PLAN.md).

## Implemented so far

Core primitives **#1 (Employee/org table)** and **#2 (RBAC + scope resolver)** —
see the primitives table in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md):

- `employees/` — `Employee` (self-FK `manager`, `status` enum), `Department`,
  `Designation`, `Location`, `LegalEntity` (seeded with exactly one row).
- `accounts/` — custom `User` (direct FK to `Role`), `Role` (admin-creatable,
  4 starter roles seeded), `Permission`, `RolePermission` (scope tier per
  role+permission), `UserPermissionOverride` (per-individual grants/denials).
- `core/scope.py::resolve_employee_scope(user, permission_code)` — resolves all
  7 scope tiers (`self`/`manager`/`team`/`department`/`location`/`legal_entity`/
  `all`); `team` uses a recursive CTE over the `manager` self-FK.
  `core/scope.py::user_has_permission(user, permission_code)` — flat yes/no check
  for non-employee-keyed capability permissions (e.g. `roles.manage`).
  `core/permissions.py` — the two DRF permission classes views use to enforce
  both of the above. Covered by `core/tests/test_scope.py` (every
  tier, override precedence, explicit deny).

**API surface** (mounted at `/api/v1/`, camelCase in/out via
`djangorestframework-camel-case`, pagination as `{results, total, page,
pageSize}` — **except the employee directory, see below**):

- **Employee directory** — `/employees/` (list is scope-filtered via
  `employees.read`; retrieve on an out-of-scope employee is a 403, not a
  filtered-away 404), `/departments/`, `/designations/`, `/locations/`,
  `/legal-entities/` (read-only reference lists). **Deliberately breaks the
  camelCase/paginated convention** — verified live against the actual
  frontend (`employees/page.tsx`, `org/page.tsx`, `profile/page.tsx`), not
  assumed from docs: these three pages read `{success, data}` with
  snake_case fields and a bare array, not `{results, total, ...}`. See
  `employees/views.py::FrontendEnvelopeMixin`. This was caught by actually
  running the frontend against the backend end-to-end (log in as a demo
  user, hit `/employees`) — the network calls returned 200 with correct data
  and the page still rendered "Request failed," because the shape didn't
  match what the page's own code expected. Confirmed fixed the same way:
  logged in as `demo.hradmin@hrms.local`, the Organization page renders all
  97 real employees; logged in as `demo.employee@hrms.local`, the page is
  absent from nav and direct navigation to `/employees` redirects home.
- **RBAC management**, gated behind `roles.manage`, every write audited
  (`audit/mixins.py::AuditedModelViewSet`) — `/roles/` (full CRUD, read-only
  nested `permissions`), `/permissions/` (read-only — codes are declared in
  code, not admin-creatable), `/role-permissions/` (grant/revoke a permission
  on a role at a scope tier; `?role=<id>` filters), `/user-permission-overrides/`
  (per-individual grant/deny; `?user=<id>` filters), `/users/` (the missing
  link: assigns a `Role` to a `User` — without this, custom roles/permissions
  are inert since nobody could ever actually be given one; `?search=` by
  name/email; `POST /users/{id}/reset-password/` — admin-driven reset,
  returns a one-time temporary password, audited without ever logging the
  password itself).

**Auth** — `POST /auth/login` (`{email,password}` → user + JWT pair, IP-rate-
limited via `throttle_scope="login"`, per-account lockout after 5 failures in
15 minutes via `FailedLoginAttempt` — two separate defenses for two separate
threats), `POST /auth/refresh` (rotates, blacklists the old token), `POST
/auth/logout` (blacklists), `GET`/`PATCH /users/me` (returns `roles:
[{name, archetype}]`, `permissions`, and the `scope` field the frontend's
`ManagementScope` actually consumes — see `accounts/auth_views.py`'s
docstring for where the contract docs had drifted from the real frontend
code). Every auth event (login success/failure/lockout, logout, refresh,
profile update) is audited. `python manage.py createinitialadmin` (reads
`INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`, idempotent — the real
production bootstrap) and `python manage.py seed_demo_users` (one login per
starter role, password `DemoPass123!`, disposable test fixtures) are both
available.

**Audit** — `audit.AuditLog`, strictly append-only (no update/delete path
anywhere, not even in `/admin/`), written via `audit/service.py::write_audit()`.
Wired into every auth event and every RBAC mutation. Diffs are stored
camelCase to match everything else in the API, not raw Python snake_case.

**Session management** — `GET /users/me/sessions` (a user's own active
refresh tokens), `DELETE /users/me/sessions/{id}` (revoke one, e.g. "log out
that other device" — 404s on someone else's session rather than leaking that
it exists), `POST /users/{id}/revoke-sessions/` (admin force-logout,
`roles.manage`, audited). Built directly on `djangorestframework-simplejwt`'s
`OutstandingToken`/`BlacklistedToken` — a session is just an issued,
unexpired, unrevoked refresh token; there's no separate session model.

The RBAC engine and employee directory are complete and are the base other modules
plug into. Employee/org model, roles and permissions, seven scope tiers, per-person
overrides, enforcement, authentication and hardening, session management, audit
logging, directory reads **and writes** (create, edit, exit; scoped by
`employees.write`), password change, and role assignment against the real employee
population, all covered by 188 automated tests running against real Postgres
(`pytest` in `backend/`) and by live verification (below).

Since the first version, the following also landed: deactivated roles grant nothing;
write actions on employee-scoped views need their own permission (read can no longer
authorise create/update/delete); one error shape for the whole API; employee status
`exited` ends access at once; the permission registry, startup wiring checks, plug-in
conformance kit and reference module described in [`MODULE-GUIDE.md`](MODULE-GUIDE.md);
`show_schema`, `access_matrix` and `seed_demo_org` (see [`DATABASE.md`](DATABASE.md)).

**Not built:** notifications, documents, and every real plug-in module (Attendance,
Leave, Payroll, ...). Independent human review of `core/scope.py` and the auth code is
still outstanding. Open data items: 28 real employees have no manager, no employee has
a legal entity assigned, and the 93 real employees have unusable passwords until an
admin issues a temporary one (`POST /users/{id}/reset-password/`) and they change it
(`POST /users/me/change-password`).

## Admin panel (Access control)

A section of the existing frontend at `/admin` (sidebar: **Access control**), shown only to people holding `roles.manage`. Four tabs: **Roles & permissions** (create and edit roles, set each permission's reach, deactivate or delete), **People** (change a role, deactivate, reset a password, sign out everywhere, add personal exceptions, and preview exactly who a person can reach), **Personal exceptions** (all of them, removable), and **Activity log** (needs `audit.read`).

It uses the RBAC APIs above plus `GET /audit-log/` and `GET /users/{id}/access-preview/`. In the frontend, every call goes through one whitelisted proxy route (`src/app/api/admin/[...path]`); the UI is in `src/components/admin/`. Safeguards: an administrator cannot change their own role or deactivate themselves (enforced by the API, not only the UI), and a role that people still hold cannot be deleted (a clear 409 that suggests deactivating instead). It was checked by driving the real screens with fictional demo logins, and `verify_rbac` covers the new API behaviour.

## Employee and organisation module

Built on the existing 97 employees, and fully manageable from the frontend at
`/manage-org` (sidebar: **Manage organisation**, shown to holders of `employees.write` or
`org.manage`). Three tabs: **Employees** (add, edit, filter, record departures and
returns, personal details, per-person history), **Organisation structure** (departments as a
tree, job titles, locations, legal entities, business units, cost centres), and **Reporting
lines** (an expandable tree, with a shortcut to the people who have no manager).

What it adds to the core:

- **Model:** business units, cost centres, and on each employee the business unit, cost
  centre, employment type, joining and exit dates, exit reason, and personal details
  (personal email, phone, date of birth, gender).
- **Permissions** (declared in `employees/rbac.py`): `org.manage`, `employees.personal.read`,
  `employees.personal.write` (all HR Admin by default), and `ess.profile.read` /
  `ess.profile.write` (everyone, for their own profile).
- **Personal details are kept out of the ordinary directory.** They live at
  `/employees/{id}/personal/` behind their own permissions, and the audit entry records which
  fields changed, never the values.
- **Self-service:** `GET/PUT/PATCH /ess/profile` is always the caller's own record; it can
  change only contact details, date of birth and gender.
- **Lifecycle:** marking someone as left records the exit date and ends their access at once;
  bringing them back clears the exit details and restores it.
- **Structure management** at `/org/<kind>/` (org.manage): a unit that people still belong to
  cannot be deleted (a clear 409 that suggests deactivating); departments cannot form loops.
- The frontend's Organisation and Profile pages, which called `/business-units`,
  `/cost-centers` and `/ess/profile` before they existed, now load completely.

Checked live with `python manage.py verify_employees` (74 checks, including the plug-in
conformance kit against the directory), and by driving the real screens with fictional
demo logins.

**Sample data.** `python manage.py seed_sample_org_data` fills the gaps on the existing
employees with labelled placeholders: three sample business units, one sample cost centre per
department, a placeholder joining date worked out from each employee code, and the default
legal entity. It never overwrites a real value, and `--remove` takes the samples back out
(it does not undo the legal-entity assignment). Real dates and assignments come from HR through
the screens or an import and replace the placeholders.

## Building a module on top of RBAC and the directory

Read [`MODULE-GUIDE.md`](MODULE-GUIDE.md). In short: add your app to `INSTALLED_APPS`,
declare permissions in `<app>/rbac.py`, put an `employee` FK on your models, set
`required_permission` / `write_permission` / `action_permissions` on your view, and
expose `api_urls.py`. Routes and permissions are picked up automatically, startup
checks catch wiring mistakes, and one declaration
(`core.conformance.ScopedEndpoint`) gives you a live `verify_<module>` command and a
pytest test that prove the module honours every scope tier. `example_leave/` is a
complete working reference.

## Live verification (required for every module and change)

Results have to be visible, not only asserted. Each module ships a management
command that builds a small fictional company, logs in as each person through the
real API against the real Postgres, and prints every request and every check as
it happens. The run is wrapped in a transaction and rolled back, so it is safe
against the dev database, and it exits non-zero on any failure so CI can run it.

```bash
python manage.py verify_rbac
```

`verify_rbac` currently runs 87 checks in about three seconds: authentication
(wrong password, replayed refresh token, lockout, throttling), directory
visibility under the four starter roles, custom roles created live at every scope
tier (team, department, location, legal entity), per-individual grant and deny
overrides, who may administer roles, session revocation and deactivation,
directory writes, leaving and returning, role deactivation, and the audit trail
those actions leave. Sample of the output:

```
== 3. Custom roles and every scope tier, created at runtime by an admin
     hana     POST   /api/v1/roles/  ->  201
   PASS  admin creates custom role 'VFY team reader'
     dana     GET    /api/v1/employees/  ->  200  (4 rows)
   sees: Dana, Eli, Eve, Maya
   PASS  Dana now sees exactly the 'team' population
```

Add `--html` for a self-contained report (saved under `verification-reports/`, which
is git-ignored) and `--open` to show it in the browser. `verify_example_leave` does the
same for the reference module, proving the plug-in mechanism end to end.

To add one for a new module, subclass `core.verification.VerificationCommand`
and implement `verify(self, v)`; the harness provides `v.login(...)` (a real
`/auth/login`), request tracing, `v.expect(...)`/`v.check(...)`, the rollback and
the exit code. See `accounts/management/commands/verify_rbac.py` as the worked
example, and `accounts/tests/test_verify_rbac.py` for how to prove the command
fails when the behaviour it checks is broken (a verification that cannot fail
proves nothing). Output never echoes response bodies, since the dev database may
hold real employee data.

## Real employee data — this repo is public

**Never commit real names, emails, or org data.** `.gitignore` excludes
`backend/**/management/commands/data/` for exactly this reason — a loader
script (e.g. `accounts/management/commands/import_employee_directory.py`) is
tracked; the data file it reads is not, and never should be. The actual
roster lives in a private location outside this repo (ask whoever ran the
import most recently where that currently is — a private sheet/gist/HR
export, not fixed infrastructure); to re-run an import, fetch the current
file from there and drop it at the path the command expects, run the
command, then leave the file in place locally (gitignored) or delete it —
either is fine, just never `git add -f` it.

## Postgres

Local Postgres runs as a **dedicated dev-only cluster in `backend/.pgdata`**,
not the machine's system-wide Postgres service (this machine happens to have
one installed at `C:\Program Files\PostgreSQL\17`, running as a Windows
service on port 5432 — deliberately left untouched: resetting its superuser
password would have meant weakening its auth, even temporarily). This
project's cluster reuses the same PostgreSQL 17 binaries but is a separate,
isolated data directory on **port 5433**, with its own `hrms`
superuser/password set at `initdb` time — no Docker, no admin rights, no
shared state with anything else on the machine.

```bash
./pgdev.sh start    # or: "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D .pgdata -l .pglogs\postgres.log -o "-p 5433" start
./pgdev.sh stop
./pgdev.sh status
```

It's already initialized and running from setup — `pgdev.sh start` is only
needed after a reboot or if you've stopped it. Not started automatically on
login; nothing outside this repo's `.env` points at it.

## Local setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements-dev.txt
cp env.example .env             # already POSTGRES_PORT=5433 — matches pgdev.sh above

./pgdev.sh start                # if not already running
python manage.py migrate        # applies schema + seeds 4 starter roles + the default legal entity
python manage.py runserver 0.0.0.0:3000   # matches the frontend's BACKEND_API_URL
```

Tests run against real Postgres, not sqlite (see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)'s tech stack table for why)
— confirmed passing against this cluster:

```bash
pytest
ruff check .
black --check .
```

To exercise the real auth flow (or, for a fuller demo, `python manage.py seed_demo_org`, which adds a fictional eight-person organisation with logins `demo.<name>@hrms.local` / `DemoPass123!`, removable with `--remove`): `python manage.py seed_demo_users` creates
one login per starter role (password `DemoPass123!`), then `POST
/api/v1/auth/login` with one of those emails. For `/admin/` access
specifically, `python manage.py createsuperuser` still works via Django's own
session auth.

Read, in order, before writing more backend code:

1. [`../docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md) — roles, scope tiers, modules, security baseline
2. [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — the seven core primitives, tech stack, API contract
3. [`../docs/IMPLEMENTATION-PLAN.md`](../docs/IMPLEMENTATION-PLAN.md) — phases, timeline, parallelization
4. [`../docs/TASKS.md`](../docs/TASKS.md) — the actual task breakdown to execute against
5. [`../docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) — local dev setup once the project scaffold exists
