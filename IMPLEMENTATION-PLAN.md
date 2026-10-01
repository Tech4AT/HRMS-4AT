# Implementation Plan

Source: *HRMS — Implementation Plan* (Django + DRF backend, against a Next.js
frontend that stays as-is). This is the execution plan against
[REQUIREMENTS.md](REQUIREMENTS.md) / [ARCHITECTURE.md](ARCHITECTURE.md), refined to
close security gaps, frontend contract mismatches, and MVP scoping issues, while
optimizing for a 4-engineer parallel team. For the concrete, ordered tasks this plan
expands into, see [TASKS.md](TASKS.md).

## The contract Django must match

The Next.js frontend proxies backend calls through `frontend/src/app/api/*`. Django's
URLconf mounts at `/api/v1/`. **The frontend does not change** — the backend is built to
this exact shape.

**[corrected]** The two bullets below (`scope` field, frontend archetypes) were wrong
in every earlier version of this doc — written against the *planned* contract without
actually reading `frontend/src/lib/api/proxy.ts` and `frontend/src/lib/auth/
auth-context.tsx` first. Once the backend's auth endpoints were built against those
files directly, both turned out to diverge from what was documented here. Corrected
now; see `backend/accounts/auth_views.py`'s docstring for the same note closer to the
code.

- `POST /auth/login`: `{email, password}` → `{success, data: {user: {id, email,
  firstName, lastName}, accessToken, refreshToken}}`. Tokens travel in the JSON body
  only — the frontend's own route handler (`app/api/auth/login/route.ts`) is what sets
  the `HttpOnly` cookies from that body; Django never sets or reads an auth cookie
  itself. `GET /users/me` and friends authenticate via `Authorization: Bearer <token>`
  (`djangorestframework-simplejwt`'s `JWTAuthentication`), not a cookie.
- `POST /auth/refresh`: `{refreshToken}` → `{success, data: {accessToken,
  refreshToken}}` (rotated pair — `ROTATE_REFRESH_TOKENS=True`,
  `BLACKLIST_AFTER_ROTATION=True`, so the old refresh token is rejected on replay).
- `POST /auth/logout`: `{refreshToken}` → best-effort blacklist; the frontend never
  blocks logout on this call failing.
- `GET /users/me`: returns `{success, data: {id, email, firstName, lastName, roles:
  [{name, archetype}], permissions: [], scope: {...}}}`. `roles` returns exactly one
  element, now carrying an explicit `archetype` field (see `core/enums.py`'s
  `RoleArchetype`) — not just `name` as originally documented. **`scope` is a real,
  load-bearing field** — `frontend/src/lib/auth/auth-context.tsx`'s
  `ManagementScope` type (`{kind:'self'}` | `{kind:'team', employeeIds: string[]}` |
  `{kind:'org'}`) is actively consumed by `hasOrgScope()`, which gates the Organization
  page — this doc previously claimed dropping it was "a deliberate contract decision,"
  which was never true of the actual frontend code. `permissions` is a flat array of
  strings (`core/scope.py::user_effective_permissions`).
- **Frontend archetypes — only 3 exist, not 4.** The frontend's actual UI-gating type
  (`frontend/src/lib/auth/usePermission.ts`'s `RequiredRole`, and the nav `roles`
  arrays in `frontend/src/app/(app)/layout.tsx`) is `'employee' | 'admin' |
  'superadmin'` — there is no frontend concept of "manager" or "finance" at all. This
  doc originally guessed a 4-value `roleMapping` (`employee/manager/hr_admin→admin/
  finance`) that was never checked against that source and doesn't correspond to
  anything real. Every `Role` (starter or custom) now carries an explicit `archetype`
  field set at creation time — the frontend reads `roles[0].archetype` directly
  instead of maintaining its own name-based lookup table. Starter-role mapping: HR
  Admin → `superadmin` (needs the org-wide Organization page), Finance → `admin`
  (needs Reports, not the full org directory), Manager → `employee` (no dedicated
  frontend surface — manager-only access is enforced entirely server-side via scope
  tier, not by frontend archetype).
- Error shape: `{ "success": false, "error": { "code": "VALIDATION_ERROR", "message":
  "...", "fields": {...} } }`.
- Pagination shape: `{results: [...], total: N, page: N, pageSize: N}`.

## Parallelization strategy (team of 4)

Core phases (0–2) require tight coordination; from Phase 3 onward, engineers work in
completely separate Django apps with no file-level conflicts.

- **Engineer 1 (Lead/Core):** Scaffolding, Auth, RBAC, `core/scope.py`, Audit
  framework, Performance module.
- **Engineer 2 (Core Apps):** Employees CRUD, Approvals generic framework, Documents
  access matrix, Offboarding/Exit, Analytics module. *(Recruitment was reassigned to
  Offboarding — see the conflicts note in [README.md](README.md).)*
- **Engineer 3 (Features):** Frontend `roleMapping` fixes, Attendance, Leave, Helpdesk
  module.
- **Engineer 4 (Infra/Payroll):** CI/CD & Backups, Payroll, Community, Expense &
  Assets modules.

## Phases, timeline, and milestones

Starting date: September 17 (Thursday), excluding weekends.

| Phase | Duration | Start | End | Primary outcomes |
|---|---|---|---|---|
| Phase 0: Scaffolding | 2 days | Sep 17 (Thu) | Sep 18 (Fri) | Runnable project, Postgres, CI, backups. |
| Phase 1: Auth & RBAC | 4 days | Sep 21 (Mon) | Sep 24 (Thu) | Auth contract matched, IDOR fix verified, audit live. |
| Phase 2: Core Apps | 4 days | Sep 25 (Fri) | Sep 30 (Wed) | Employee CRUD, generic approvals, document access matrix. |
| Phase 3: MVP Module (Attendance) | 3 days | Oct 1 (Thu) | Oct 5 (Mon) | First plugin live end-to-end. |
| **Milestone 1: MVP Ready** | 13 days | Sep 17 | Oct 5 | System usable end-to-end for Auth & Attendance. |
| Phase 4–8: Remaining Plugins | 14 days | Oct 6 (Tue) | Oct 23 (Fri) | All other modules built in parallel. |
| **Milestone 2: Prototype Ready** | 27 days | Sep 17 | Oct 23 | All modules functional but not hardened. |
| Phase 9: Hardening | 3 days | Oct 26 (Mon) | Oct 28 (Wed) | Pen-test prep, DR drill, final security pass. |
| **Milestone 3: V1 Launch Ready** | 30 days | Sep 17 | Oct 28 | Production-ready system. |

### Phase 0 — Scaffolding

`manage.py` + split settings (`base.py`/`dev.py`/`test.py`/`prod.py`); Postgres via env
vars, `env.example` documented; `pytest-django` against real Postgres with
`--reuse-db`; CI running `ruff check`, `black --check`, `pytest` (coverage ≥85%,
applied to every app, not just core); global camelCase JSON rendering; `pg_dump` cron +
`restore_from_backup` smoke test; empty app skeletons for every core and plugin app;
cookie defaults in `base.py`.

**Done when:** `runserver` starts cleanly; `pytest` passes with 0 tests collected; CI is
green; the backup script runs and the restore has been manually verified once.

### Phase 1 — Core: Identity, RBAC, Auth

⚠ **Highest-risk phase.** `core/scope.py` is the direct fix for a confirmed, live IDOR
vulnerability. Nothing in this phase merges without a mandatory second review.

`accounts` app (`User`, `Role`, `Permission`, `RolePermission`, single-role-per-user via
direct FK, seeded with the 4 roles + dot-notation permission strings); the final
`Employee` model (self-FK `manager`, `status` enum — Department/Designation CRUD
deferred to Phase 2); `core/scope.py::visible_employee_ids(user)`; auth endpoints via
`djangorestframework-simplejwt` with rotation + blacklisting; Argon2 hashing; audit
wired into login success/failure, logout, refresh, role assignment; `FailedLoginAttempt`
lockout (5 attempts → 15 min) plus a login-endpoint rate throttle (the lockout alone
doesn't stop one IP hammering many accounts); admin-driven password reset;
`createinitialadmin` management command.

**Done when:** all 4 roles log in via the unmodified frontend; `GET /users/me` matches
the contract; the full IDOR test suite proves self/direct-manager/hr_admin access and
denies skip-level/cross-department; `core/scope.py` and the auth endpoints have an
explicit second sign-off recorded.

### Phase 2 — Core: Org, Approvals, Files

Employee serializer gates `bank_account_number`/`salary` to `hr_admin`/`finance`
(tested for both silent-read and silent-write-drop); `Department`/`Designation` CRUD
with soft-delete (`is_active`, never hard-delete); `approvals.Request` generic model,
`payload_json` validated via a serializer dispatched on `request_type`, status
transitions (`pending → approved | rejected | withdrawn`, terminal states never
re-transition), and the stuck-request escape hatch (HR Admin reassigns or force-resolves);
`documents.Document` model + upload/download behind a per-`entity_type` access matrix
(with a test proving every non-listed role is denied); `notifications.send_email()`
helper with a dev-environment email backend.

**Done when:** HR Admin can fully manage org structure; file access respects the strict
matrix on both the allow and deny side; `approvals.Request` — including the escape
hatch — is ready for Phase 3+ modules.

### Phase 3 — MVP Module: Attendance → MVP Ready

`AttendanceRecord` model; clock-in/clock-out with IDOR-safe `employee_id` derivation
(strictly from `request.user.employee.id`, never the request body — this is the
write-side counterpart to Phase 1's read-side fix); validation for double clock-in,
clock-out-without-clock-in, and clock-in while `exited`; manager-scoped read via
`visible_employee_ids()` through a read-only serializer; regularization flow
(`approvals.Request`, `request_type=attendance_regularization`, approver resolved via
the shared `resolve_approver()` helper, record updated + audited on approval); frontend
wired against real endpoints.

**Done when (MVP Ready):** `me/attendance` and the manager's team view are fully live;
the regularization flow works end-to-end; the full IDOR write-and-read test suite
passes.

### Phase 4–8 — Remaining Plugins (highly parallel)

Each engineer owns fully isolated Django apps from here on:

- **E1 — Performance:** `Goal`, `Review`; sign-off via `approvals.Request`
  (`request_type=performance_review`); single-approver only, no multi-level chain.
- **E2 — Offboarding, Analytics:** on hire, `Employee.status = active` (small hook, no
  candidate pipeline); resignation/exit initiation via `approvals.Request`
  (`request_type=exit_approval`); notice-period tracking; a fixed, non-configurable
  exit-task checklist; a read-only final-settlement summary (reads Leave/Expense/Assets
  directly, doesn't post/pay); `Employee.status = exited` once the checklist is
  complete + login rejected from that point; Analytics as read-only cross-module
  queries, under the same RBAC/scope rules as everywhere else.
- **E3 — Leave, Helpdesk:** `LeaveType`, `LeaveBalance`; leave requests via approvals;
  `select_for_update()` on balance updates with a concurrency test proving it actually
  prevents the race; carry-forward policy per the open business decision; Helpdesk
  ticketing (decide up front whether `approvals.Request` fits a ticket's lifecycle or a
  small dedicated model is needed).
- **E4 — Payroll, Community, Expense, Assets:** `SalaryStructure`/`SalarySlip`, reading
  Attendance/Leave directly; proration per the open business decision; payslip PDFs via
  `weasyprint`, stored through `documents` (`entity_type=payslip`) to inherit its access
  matrix; Community's concrete models (`Post`, `Poll`, `Praise`, `Announcement`);
  Expense claims/reimbursement via approvals + documents; Assets issue/return; the
  asset-recovery trigger as an inline call from the `Employee.status` update endpoint
  when it transitions to `exited` (no polling job).

**Done when (Prototype Ready):** every module's frontend pages are live against real
endpoints; each module's tests pass; the CI coverage gate is green across every app;
the Exit/Offboarding flow works end-to-end, closing the highest-priority gap from the
plan review.

### Phase 9 — Hardening & Launch

Whole team executes the checklist together: grep for hardcoded secrets; confirm HTTPS
everywhere including internal calls; confirm disk-at-rest encryption in the actual
production instance, not just assumed; run an actual DR drill (restore into a fresh DB,
verify row-level integrity, not just "the command exited 0"); confirm the Phase 1 login
throttle and JWT blacklist-cleanup cron are actually running in the target deployment
environment, not just present in the codebase; confirm the Phase 2 approvals escape
hatch works end-to-end with at least one real test; a final access-control pass over
every sensitive field/endpoint added across Phases 1–8, for each of the 4 roles, via
direct API calls (not just "hidden in the UI"); package the app for an external
pen-test with scoped test accounts and no production data.

**Done when (V1 Launch Ready):** the security checklist is verified, not just
attempted; the DR drill succeeded with confirmed data integrity; the external pen-test
is scheduled or completed.

## Open questions

| # | Question | Phase | Recommendation / default |
|---|---|---|---|
| 1 | 5th role (IT/System Admin)? | 1 | Defer for MVP. `hr_admin` handles provisioning initially. |
| 2 | Frontend "super admin" mapping? | 1 | Grep and remove/redirect to `hr_admin`. |
| 3 | Skip-level manager visibility? | 1 | No. Direct reports only, per the PRD. |
| 4 | SSO vs. passwords? | 1 | Build password auth first; ask the stakeholder if Google Workspace/M365 is required for MVP. |
| 5 | `payload_json` validation? | 2 | Validate via dispatched serializers based on `request_type`. |
| 6 | Document access exceptions? | 2 | No blanket rules — per-`entity_type` access matrix. |
| 7 | Leave carry-forward policy? | 4–8 | Business decision. Default: 0 carry-forward, or capped at 5 days for MVP. |
| 8 | Payroll proration formula? | 4–8 | Business decision. Default: calendar-days proration. |

## Explicitly not being built

Multi-tenancy, a scope/ABAC engine, a workflow/BPM engine, a message queue or event
bus, a storage abstraction layer, tenant-configurable custom roles, a state-machine
engine for employee status, per-tenant encryption keys, SOC2-grade immutable ledgers,
field-level ABAC policy engines. (Full security baseline that *is* non-negotiable is in
[REQUIREMENTS.md](REQUIREMENTS.md).)
