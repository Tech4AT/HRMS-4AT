# Architecture

Source: *HRMS — Architecture PRD v1* §1, §3, §5, reconciled with the *Implementation
Plan*'s Django/DRF choice (see the PRD self-contradiction noted in
[README.md](README.md) — the PRD's own diagram says Django, its own table says
NestJS; Django is what's actually being built).

Nothing below is a framework. Each primitive is the smallest thing that closes a real
requirement, and every module (Attendance, Leave, Payroll, …) reads and writes through
these seven instead of inventing its own version of any of them.

## The seven core primitives

| # | Primitive | Django app / model(s) | What it closes |
|---|---|---|---|
| 1 | Employee/org table | `employees` — `Employee` (self-FK `manager`, FKs to `Department`/`Location`/`LegalEntity`), `Department`, `Designation`, `Location`, `LegalEntity` | One source of truth for "who reports to whom" and which org dimensions (department/location/legal entity) each employee belongs to. A self-referencing FK with a recursive CTE covers both the `manager` tier (direct reports, no recursion) and the `team` tier (full transitive subtree) — no graph DB needed for either. `LegalEntity` is seeded with exactly one row today (single-entity company) but exists as a real table from day one so a second entity is a data change, not a schema change. |
| 2 | RBAC + scope resolver | `accounts` app + `core/scope.py::resolve_employee_scope(user, permission_code)` | A `roles`/`permissions`/`role_permissions` table set (roles are admin-creatable, not a fixed 4 — see [REQUIREMENTS.md](REQUIREMENTS.md) §0), plus a `user_permission_overrides` table for per-individual grants/restrictions on top of a role. **Not** general ABAC — permission *codes* are still declared in code, and scope is a closed, enumerated tier (`self` / `manager` / `team` / `department` / `location` / `legal_entity` / `all`) set per `(role, permission)` row, not an arbitrary attribute-matching policy engine. `resolve_employee_scope()` is the direct fix for a confirmed, live IDOR (any employee could read any other employee's record) — applied inline in every employee-keyed queryset: `WHERE employee_id IN (resolve_employee_scope(user, permission_code))`. One `WHERE` clause per query, not a scope service or guard abstraction — but it has to be there in every module that exposes an employee-keyed read or write. |
| 3 | Approval workflow | `approvals` app — `Request(id, request_type, requester, approver, status, payload_json, created_at, updated_at)` | One generic table backs every approval flow (leave, expense, asset, attendance regularization, exit). `approver` is decided by application code at creation time (typically `requester.manager`) — no configurable routing engine, no multi-level escalation. |
| 4 | Audit log | `audit` app — `AuditLog(id, actor, action, entity_type, entity_id, diff_json, created_at)`, append-only | Nothing ever deletes from it. Written via a direct function call, `write_audit(...)`, at each mutation point that changes something worth tracking — not an event bus, not a signed ledger. |
| 5 | Notifications | `notifications` app — `send_email(...)` / Slack webhook helper | A direct function call invoked at specific trigger points ("leave approved" calls `send_email` right there in the approval handler). No message broker, no pub/sub. |
| 6 | File storage | `documents` app — `Document(id, entity_type, entity_id, path, uploaded_by, uploaded_at)` + S3/local disk | The `documents` table is the abstraction — not a storage interface layer. Access is derived from a per-`entity_type` access matrix (e.g. `payslip` → employee + hr_admin + finance; `id_document` → employee + hr_admin). |
| 7 | Employee status | Plain enum column, `Employee.status` (`active` / `on_leave` / `exited`) | Gates writes (no clock-in if exited, prorate payroll on exit) and drives lifecycle triggers (asset recovery). Literally one column — not a state-machine engine. |

## Scope resolution

`core/scope.py::resolve_employee_scope(user, permission_code)` is the single most
important function in the codebase. Given a user and the permission code the current
action requires, it:

1. Looks up the scope tier for that `(role, permission)` pair, and separately checks
   for a `UserPermissionOverride` on that exact `(user, permission)` — an override wins
   over the role's own grant if one exists (whether that's a wider or narrower scope,
   or an explicit denial).
2. Dispatches on the resolved tier to return the matching `Employee` queryset:

| Tier | Resolution |
|---|---|
| `self` | `{user.employee_id}` |
| `manager` | Direct reports of `user.employee` — one level, no recursion. |
| `team` | The full transitive subtree under `user.employee` (direct + indirect reports), via a recursive CTE over the self-referencing `manager` FK. |
| `department` | All employees with `department_id == user.employee.department_id`. |
| `location` | All employees with `location_id == user.employee.location_id`. |
| `legal_entity` | All employees with `legal_entity_id == user.employee.legal_entity_id`. |
| `all` | Every employee. |

Every employee-keyed queryset in every module calls this function and filters on its
result — `WHERE employee_id IN (resolve_employee_scope(user, permission_code))` — rather
than re-implementing any tier's logic locally. `department`/`location`/`legal_entity`
resolution depends on the `Employee` FKs those tiers read, which land in Phase 2
alongside the `Department`/`Designation` models (see
[TASKS.md](TASKS.md)) — `self`/`manager`/`team`/`all` are resolvable from Phase 1 on,
since they only need the `manager` self-FK that exists from day one.

## Request authorization flow

```
HTTP request
    ↓
Auth middleware — who are you
    ↓
Role/override check — does this user hold the permission, at what scope   → no  → 403
    ↓ yes, and it's an employee-keyed read/write
Inline WHERE filter — employee_id IN resolve_employee_scope(user, permission_code)   → not in scope → 403
    ↓
Module handler
    ↓
PostgreSQL — one DB
```

No route queries the database before the permission check runs.

## Approval request lifecycle

```
requester creates row in `requests`
            ↓
         pending
        /    |    \
approver  approver  requester
 acts      acts      cancels
   ↓         ↓          ↓
approved  rejected  withdrawn
(terminal)(terminal)(terminal)
```

Terminal states never transition again. An HR Admin can reassign a stuck `pending`
request's approver, or force-resolve it directly — the escape hatch for when the
original approver goes on leave, exits, or is reassigned mid-request.

## How a new module gets built

1. Owns its own tables → PostgreSQL (Django models/migrations).
2. Checks permission via → `roles`/`permissions`/`role_permissions` (+ per-user
   overrides).
3. Filters employee-keyed queries inline via → `resolve_employee_scope()`'s `WHERE`
   clause.
4. Needs approval? → writes a row to `requests`.
5. Needs to tell someone? → calls `send_email(...)`.
6. Needs a file? → writes a row to `documents`.
7. Mutated something? → calls `write_audit(...)`.

Nothing above the primitives has its own login, its own approval logic, or its own audit
log — it all goes through the seven primitives. That delegation is what makes a module
"plug and play."

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Django + DRF, one deployable, organized by app folder | No hard module-boundary enforcement needed at this size — Payroll reading Attendance/Leave tables directly is fine here. |
| Database | PostgreSQL, single schema, Django ORM | Direct control over the exact queries the manager-filter depends on. No `organization_id` anywhere — there's no second tenant to isolate from. |
| Auth | JWT access + refresh (`djangorestframework-simplejwt`), Argon2 password hashing | Matches the frontend's existing cookie-based flow without frontend changes. `ROTATE_REFRESH_TOKENS=True`, `BLACKLIST_AFTER_ROTATION=True`. |
| Access control | `roles`/`permissions`/`role_permissions`/`user_permission_overrides` + DRF permission class, plus the inline scope filter | A small reusable function (`core/scope.py::resolve_employee_scope`) with a closed 7-tier scope enum, not a general ABAC framework. Single role per user still holds (a direct FK from `User` to `Role`, not M2M) — individual customization goes through `UserPermissionOverride`, not multi-role. Roles themselves are admin-creatable, not a fixed set — see [REQUIREMENTS.md](REQUIREMENTS.md) §0. |
| Approvals | One generic `requests` table (`approvals` app) | No workflow/BPM engine. |
| Events/notifications | Direct function calls at the point of action (`send_email`, `write_audit`) | No message broker, no in-process event bus. |
| File storage | S3 (`django-storages`, or local disk for smaller deployments) + `documents` table of path pointers | No storage abstraction interface. |
| Frontend | Unchanged — Next.js, role-driven UI gating | See [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) for the exact API contract. |
| Testing | `pytest-django` + `factory_boy` against real Postgres | No sqlite shortcuts — the manager-filter's exact query behavior has to be verified against the real engine. |

**Roles & permissions:** single role per user, but roles themselves are admin-creatable
— starter set is Employee, Manager, HR Admin, Finance, more can be added freely (see
[REQUIREMENTS.md](REQUIREMENTS.md) §0). Permissions are enumerated strings in
**dot-notation** (`attendance.read`, `leave.approve`, `expense.write`, …) — see the
notation conflict noted in [README.md](README.md). Scope is a separate axis from the
permission code itself (no more `scope.all`-as-a-permission-string): each
`RolePermission`/`UserPermissionOverride` row carries its own scope tier out of the
closed 7-value enum in [REQUIREMENTS.md](REQUIREMENTS.md) §0.

## Explicitly not being built

Multi-tenancy, a general attribute-matching ABAC engine (scope stays a closed 7-tier
enum, not arbitrary attribute rules), a workflow/BPM engine, a message queue or event
bus, a storage abstraction layer, a state-machine engine for employee status, per-tenant
encryption keys, SOC2-grade immutable ledgers, rate-limiting per tenant, and the PASA
document's full enterprise catalogue (15 named admin roles, AND/OR scope logic,
confidential-folder permissions, IP whitelisting, 2FA). Custom roles and per-individual
permission overrides *are* now being built (see [REQUIREMENTS.md](REQUIREMENTS.md) §0)
— this list is narrower than it was before that decision.
