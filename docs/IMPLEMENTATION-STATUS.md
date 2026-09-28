# Implementation status (RBAC branch)

Reconciles the plan docs (`REQUIREMENTS.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION-PLAN.md`, `TASKS.md`) with what the code on this branch
actually does. Read this first; the plan docs describe intent, this file
describes reality. Verified by reading the code under `backend/` (T21,
docs-only — no source was changed for this).

## Implemented vs pending

### Implemented (in `backend/`, on this branch)

- **RBAC core + scope resolver** — `backend/core/scope.py`
  (`resolve_employee_scope`, `user_has_permission`, `explain_permission`,
  `user_effective_permissions`, `resolve_management_scope`), permission
  classes in `backend/core/permissions.py` (`ScopedEmployeePermission`,
  `HasPermissionCode`), permission registry in `backend/core/registry.py`
  (each app declares codes in its own `rbac.py`; `sync_registered_permissions`
  runs on migrate). Single role per user (`User.role` FK), per-user
  overrides with explicit deny (`UserPermissionOverride`).
- **Accounts/auth** — `backend/accounts/`: email login, refresh
  rotation + blacklist, per-account lockout + per-IP throttle, `GET /users/me`
  (`roles`/`permissions`/`scope`), admin user/role/session management.
- **Approvals engine** — `backend/approvals/`: one generic `Request` table
  (`request_type`, `requester`, `approver`, `status`, `payload` JSON);
  `service.create_request` (approver defaults to requester's manager, `None`
  when there is no manager), `decide` / `withdraw` / `reassign` /
  `force_resolve`; `request_decided` signal; HTTP endpoints
  (`approve`/`reject`/`withdraw`/`reassign`/`resolve`); `approvals.manage`
  permission. Contract: `backend/approvals/README.md`.
- **Audit** — `backend/audit/`: append-only `AuditLog`
  (`actor`, `action`, `entity_type`, `entity_id`, `diff`); written via
  `write_audit()` or `AuditedModelViewSet`; read-only API gated by
  `audit.read`; no update/delete API or admin.
- **Notifications** — `backend/notifications/`: `Notification` model,
  `notify()` / `broadcast_to()` / `broadcast()`, best-effort `send_email()`;
  self-scoped list/read/read-all endpoints plus superuser-only announce.
- **Verification framework** — `backend/core/verification.py` (`Verifier`,
  `Session`, `VerificationCommand`, rolled-back transactions, `--html`
  reports) with per-module commands: `verify_rbac`, `verify_approvals`,
  `verify_notifications`, `verify_example_leave`, `verify_employees`,
  `verify_documents`, `verify_payroll`; plus `core/conformance.py`,
  `core/testing.py` (`assert_module_conforms`) and `core/fictional_org.py`.
  Reported results (see `docs/project-logs.md` and
  `docs/RBAC-ORCHESTRATION-STATUS.md`): `verify_rbac` 98/98,
  `verify_employees` 74/74, `verify_example_leave` 32/32,
  `verify_approvals` 15/15, `verify_payroll` 25/25.
- **Employee directory + org** — `backend/employees/`: employee model with
  manager self-FK, departments/sub-departments, locations, legal entities,
  lifecycle (create/update/exit), manager validation.
- **Plug-in modules** — `backend/example_leave/` (reference plug-in built on
  the approvals engine: raises `example_leave` requests, applies decisions
  via `request_decided` receiver in `handlers.py`), `backend/payroll/`
  (RBAC-scoped compensation/deductions/benefits/statutory/overtime/status +
  setup; frontend wired), `backend/documents/` (upload/list/download,
  per-entity access matrix).
- **Approvals inbox frontend** — `frontend/` Approvals page (To approve /
  My requests), `/api/requests` proxy to the engine (merged `604eb84`).
- **Tooling** — `access_matrix` diagnostic command, Docker Compose stack
  (Postgres + backend + frontend), `backend/MODULE-GUIDE.md` plug-in guide.

### Pending / not built

- Attendance, performance, offboarding/exit, expense, assets, helpdesk,
  analytics, community — planned in `IMPLEMENTATION-PLAN.md` P3–P8,
  not present in `backend/` (only `example_leave` + `payroll` + `documents`
  exist as feature modules).
- Open business questions from `REQUIREMENTS.md` / `IMPLEMENTATION-PLAN.md`
  are still open: 5th IT role (deferred), SSO vs passwords (passwords first),
  leave carry-forward policy, payroll proration formula.
- P9 hardening items (secret grep, internal HTTPS, DR restore check,
  production throttle/blacklist cron, scoped pen-test) are verification
  steps, not code — still to be run against the final deployment.
- `docs/RBAC-ORCHESTRATION-STATUS.md` tracks per-task state; some items are
  blocked (APP-6 needs a running full stack, APP-7 needs a git push re-auth).

## Corrections to plan docs

These statements in the older docs are stale; the status above supersedes
them (the plan docs are kept as intent history, not edited wholesale):

- `README.md` “Status” and `DEVELOPMENT.md` “Layout / Backend (once
  implemented)” say `backend/` is an empty placeholder / not built. Wrong:
  `backend/` holds the RBAC core, accounts, approvals, audit,
  notifications, employees, payroll, documents, and example_leave apps.
  (Pointers corrected in place; this file is the authority.)
- `ARCHITECTURE.md` describes the scope check as a single inline function
  `core/scope.py::visible_employee_ids(user)` with “no scope service/guard
  abstraction”, managers as self + direct reports only, and HR/finance
  org-wide “via role check not separate scope”. The code instead has a
  scope-tier engine: `resolve_employee_scope(user, permission_code)` with
  SELF / MANAGER / TEAM (recursive subtree) / DEPARTMENT / LOCATION /
  LEGAL_ENTITY / ALL tiers, `register_permissions()` defaults per role in
  each app's `rbac.py`, and `ScopedEmployeePermission` +
  `required_permission` / `write_permission` / `action_permissions` viewset
  attributes. Read the tier engine, not the “one WHERE” paragraph.
- `ARCHITECTURE.md` / `TASKS.md` describe a shared `resolve_approver()`
  helper every flow must call. The code has no such helper: approver
  resolution is `_approver_for()` inside `approvals/service.py`
  (requester's manager's user, else `None` for HR `reassign`). Modules only
  call `service.create_request(...)`.
- `ARCHITECTURE.md` says notifications are “`send_email`/Slack webhook …
  direct call at trigger … No broker, no pub/sub”. The code adds in-app
  `Notification` rows (`notify()` at the trigger point, e.g. approvals
  `_finalize`), a bell/inbox read API, and the `request_decided` Django
  signal carrying decision side-effects — more than a bare email helper.
- `IMPLEMENTATION-PLAN.md` / `TASKS.md` phase dates (Sep 17 – Oct 28) and
  “Done: runserver clean; pytest 0 tests” P0 exit criteria describe the
  original schedule, not current state; treat them as history.
- `REQUIREMENTS.md` says “new roles start zero permissions; explicitly
  granted, never denied”. The code supports explicit deny via
  `UserPermissionOverride(is_granted=False)`, which wins over role grants.

## Core primitives (as built)

1. **RBAC scope resolver** — `backend/core/scope.py`: override-wins
   (explicit deny beats role grant; inactive roles grant nothing),
   no-employee → empty scope, per-request memo. Module querysets must go
   through `resolve_employee_scope`; the permission class alone does not
   filter lists. `resolve_management_scope()` collapses tiers for the
   frontend (`self` / `team+ids` / `org`).
2. **Permissions** — dot-notation codes (`leave.approve`, `payroll.read`),
   declared per app in `rbac.py` via `register_permissions()`; created on
   first migrate, never overwritten (admin edits survive). Custom viewset
   actions must be listed in `action_permissions` or startup checks fail
   (`core.E001–E004`). Detail endpoints return 403, not 404, on scope miss
   (deliberate anti-IDOR behaviour).
3. **Approvals engine** — states `pending → approved | rejected | withdrawn`
   (`TERMINAL`; only `pending` transitions). Approver-only approve/reject,
   requester-only withdraw, HR-only reassign/force-resolve. `_finalize`
   persists, then `notify()` + `write_audit()` + `request_decided.send()`.
   Unassigned (`approver=None`, no manager) waits for HR `reassign`.
4. **Audit** — the only write paths are `write_audit()` and
   `AuditedModelViewSet`; diffs are camelCased before/after; failed logins
   log with `actor=None`.
5. **Notifications** — owned-by-user rows, self-scoped API (another user's
   id reads as 404); creation is a direct `notify()` call at the trigger
   point; email is best-effort and never rolls back the caller.
6. **Verification framework** — `python manage.py verify_<app> [--html]`
   runs the full HTTP stack (real JWT, per-persona IPs, cache cleared,
   rolled back, refuses `*.prod` settings, non-zero exit on failure);
   `assert_module_conforms` is the pytest twin for new plug-ins.
