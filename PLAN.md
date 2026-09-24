# Attendance & Leave — Backend Implementation Plan

Status: **planning only** — nothing in this document has been implemented.

This is a revision. The first draft made a number of architectural and business-rule
calls (exact Django app boundaries, the approval-flow pattern, scheduled-job design,
attendance-status precedence, comp-off math, penalisation deductions, absconding
handling, manager-vs-team scope) that weren't actually specified anywhere and shouldn't
have been presented as settled. This revision separates what's **confirmed** (from the
frontend code, the existing RBAC implementation, or an explicit instruction) from what's
**genuinely open** (the frontend never defines it), and doesn't pick a side on the open
items.

Re-verified directly against the current code for this revision (not just the prior
draft's notes): `frontend/src/app/(app)/layout.tsx`'s nav gating, `leave/page.tsx` and
`me/attendance/page.tsx` (confirmed: no `hasPermission` call anywhere in either — see
§3), and `backend/core/permissions.py`, `backend/core/registry.py`,
`backend/core/enums.py`, `backend/example_leave/rbac.py` read in full (not summarized).

---

## 1. Confirmed constraint: core RBAC is not touched

`backend/core/`, `backend/accounts/` (`Role`, `Permission`, `RolePermission`,
`UserPermissionOverride`), and `backend/employees/` are read from, never edited. Every
requirement below is expressed in terms of what a *new* plugin app can declare and use —
`<app>/rbac.py`, `required_permission`/`write_permission`/`action_permissions` on views,
an `employee` FK on employee-owned models — not in terms of anything that requires
changing a core file. Where a requirement seems to need a core change (see §7.4), that's
called out explicitly rather than assumed away.

## 2. Confirmed backend facts (existing RBAC & plugin mechanism)

Read directly from source, not paraphrased:

- **Plugin wiring** (`backend/config/api_urls.py`): any app in `INSTALLED_APPS` that
  isn't `employees`/`accounts` gets its `<app>/api_urls.py` auto-mounted under
  `/api/v1/`. Adding a module = add to `INSTALLED_APPS` + ship `api_urls.py`. No other
  core file changes.
- **Permission declaration** (`core/registry.py`): a module calls
  `register_permissions(PermissionSpec(code, description, default_grants={role_name:
  ScopeTier}))` in `<app>/rbac.py`. Codes must be lower-case dot-notation,
  `<module>.<action>` (validated at registration time). `default_grants` are written to
  the database **only the first time** a permission is created — an admin's later change
  to a grant survives every future `migrate`. A role name not yet present is silently
  skipped, not an error. **A given permission code has exactly one owning registration**
  — registering the identical `PermissionSpec` twice (same description, same
  `default_grants`) from two apps is harmless (the registry treats it as a no-op
  duplicate), but registering it twice with *different* definitions raises at import
  time. This matters directly for §6's "one code, several tabs" question.
- **Scope tiers** (`core/enums.py::ScopeTier`): `self, manager, team, department,
  location, legal_entity, all`. Docstring: "Every tier except SELF implicitly includes
  the caller's own record." `manager` and `team` are resolved differently in
  `core/scope.py` — `manager` is direct reports only (one level), `team` is the full
  recursive subtree. Both exist and are already implemented; nothing here requires
  building either.
- **Enforcement is mandatory, not optional** (`core/permissions.py`): any view using
  `ScopedEmployeePermission` (for employee-owned data) **must** declare
  `required_permission` (covers list/retrieve), and **must** declare `write_permission`
  if it exposes any of create/update/partial_update/destroy, and **must** map every
  custom `@action` in `action_permissions` — Django's startup checks
  (`core.E001`–`E004`) refuse to boot otherwise. `HasPermissionCode` is the equivalent
  for data that isn't employee-owned (flat check, no scope filtering).
  **Consequence for this plan**: some permission code is required for every
  read/write path a new module exposes, purely because the existing RBAC framework
  demands it — independent of whether the frontend happens to call `hasPermission` for
  that action itself (see §3 for where it does and doesn't).
- **Roles that exist today** (`accounts/migrations/0002_seed_starter_roles.py`):
  `Employee` (archetype `employee`), `Manager` (archetype `employee`), `HR Admin`
  (archetype `superadmin`), `Finance` (archetype `admin`). Roles are admin-creatable,
  not a fixed set, but these are what a fresh environment has.
- **Reference module**: `backend/example_leave/` — a small, complete, working module
  (`LeaveRequest.employee` FK, `example_leave/rbac.py` registering
  `example_leave.read`/`write`/`approve`, a view declaring all three permission
  attributes, `api_urls.py`, a conformance test). `backend/MODULE-GUIDE.md` documents
  the same steps narratively and says to copy this module. This is the only existing,
  working precedent for "how a module plugs into this RBAC" — cited throughout below.
- **Nothing for Attendance & Leave exists on the backend today.** No `leave`,
  `attendance`, `calendar`, `shift`, or `penalis(z)ation` app exists. The only hits for
  those words outside `example_leave` are doc-comment examples in `core/`. This is a
  greenfield build.
- **`Employee` model** (`employees/models.py`) already has `manager` (self FK),
  `department`, `location`, `legal_entity`, `business_unit`, `cost_center`,
  `designation`, `status` (`active`/`on_leave`/`exited`), `employment_type`,
  `employee_code`. A real, scope-checked `EmployeeViewSet` already exists at
  `/api/v1/employees`.

## 3. Confirmed frontend facts (what exists today, and exactly how it's gated)

### 3.1 Feature inventory — screens, actions, and their current data source

| Feature area | Frontend location | Current data source |
|---|---|---|
| Check-in/out, breaks, attendance log, history, summary | `/me/attendance` | Real proxy → in-memory mock (`lib/api/mock-data.ts`) at `/api/attendance/*`; full client contract in `lib/api/attendance.ts` |
| WFH & regularisation requests (submit, cancel, edit, own list) | `/attendance/wfh`, `/attendance/regularize`, inside `/me/attendance` | Same, `/api/attendance/requests*` |
| WFH/regularisation/leave **approvals** | `/approvals` | Same, `/api/attendance/requests/approvals/*`, `/api/leave/approvals/*` |
| Leave types (read), requests, own balance | `/leave` | Same, `/api/leave/*`, client in `lib/api/leave.ts` |
| Org calendar (holidays/WFH days/events + recurring WFH rule), CRUD | Settings → Calendar Management | Same, `/api/calendar/*`, client in `lib/api/calendar.ts` |
| Read-only personal+org calendar view | `/attendance/calendar` | Client-side composition over `attendanceApi.getHistory()`, no separate endpoint |
| Leave Types **CRUD** (create/edit/delete, not just read) | Settings → Leave Settings → Leave Types | Same mock backend; `POST/PUT/DELETE /api/leave/types` were added to the mock during this project — still mock-only, no real backend ever existed for this |
| Leave Balances (view + admin edit, filters by business unit/department/location) | Settings → Leave Settings → Leave Balances | **Frontend-only sample data** (`lib/attendance/sample-employees.ts` + a seeded pseudo-random "used" figure) — no API client, no proxy route |
| Shifts (create with start/end/break, assign employees) | Settings → Shifts | **Frontend-only, plain `useState`, not even `localStorage`** (`lib/attendance/shifts.ts`) — no API client, no proxy route |
| Penalisation (auto-applied, overturn request/review) + Policy/Penalization Settings (incl. Comp Off accrual) | Approvals → Penalisation, Leave Management → Penalisations block, Settings → Policy Settings, My Attendance → "Attendance Policy" popup | **Frontend-only, `localStorage`-backed** (`lib/attendance/penalisation.ts`) — no API client, no proxy route |
| Dashboard (KPIs, weekly trend, leaderboard, today's roster) | Attendance & Leave → Dashboard | **Frontend-only, deterministic pseudo-random data** (`lib/attendance/dashboard.ts`) over the same fake roster as Shifts — no API client |

`leave`/`attendance`/`calendar` already have a real proxy and a fully specified request/
response contract (types + methods in their respective `lib/api/*.ts` files) — the work
there is building the real Django app behind an *already-fixed* contract. Leave
Balances, Shifts, Penalisation, and Dashboard have **no backend concept and no API
client at all** — greenfield, including the Next.js proxy route itself for the ones that
need one.

### 3.2 Exactly how the frontend gates access today (re-verified, not assumed)

`frontend/src/app/(app)/layout.tsx`, the "attendance" nav item's children:

```
{ label: 'Dashboard',      href: '/attendance/dashboard', anyPermission: ['leave.approve', 'attendance.approve', 'scope.all'] }
{ label: 'My Attendance',  href: '/attendance' }                                          // no anyPermission at all
{ label: 'Approvals',      href: '/approvals',             anyPermission: ['leave.approve', 'attendance.approve'] }
{ label: 'Settings',       href: '/attendance/settings',   anyPermission: ['attendance.settings.manage', 'calendar.manage'] }
```

Within Settings (`attendance/settings/page.tsx`): `canManageSettings =
hasPermission('attendance.settings.manage')` gates Shifts, Leave Settings (both Leave
Types and Leave Balances), and Policy Settings; `canManageCalendar =
hasPermission('calendar.manage')` gates Calendar Management, separately. Within
Approvals (`approvals/page.tsx`): `hasPermission('leave.approve')` and
`hasPermission('attendance.approve')` gate the Leave and WFH/Regularisation tabs
respectively. **The Penalisation tab inside Approvals has no permission gate at all**
today (comment in the source: "Penalisation has no permission of its own yet ... visible
to anyone who can see Approvals") — this only worked because its data was a fixed
client-side sample with no real scoping.

**Re-verified directly**: `grep -n "hasPermission"` on `leave/page.tsx`,
`me/attendance/page.tsx`, and `attendance/calendar/page.tsx` returns **zero matches** —
the "My Attendance" group (Attendance, Leave Management, Calendar, check-in/out, submit
leave, request WFH/regularisation) is not gated by any specific permission code
anywhere in the frontend, only by being an authenticated user at all (the coarse
`roles: ['admin','employee','superadmin']` array, which every account satisfies). This
is the frontend's actual, current behaviour, not an inference — it's worth stating
plainly because it directly shapes what "minimum permissions" means in §6: the backend
will need *some* permission code for these actions regardless (§2, "enforcement is
mandatory"), but the frontend gives no signal about what that code should be named or
scoped, since it never checks.

There is also a literal `'scope.all'` string in `layout.tsx`'s Dashboard gate and in
`lib/api/mock-auth.ts`'s `MOCK_USER.permissions`. This does not correspond to anything
in the real RBAC's vocabulary (permission codes are `<module>.<action>`; "sees
everything" is expressed as a scope tier of `all` on a real permission, resolved via
`hasOrgScope()`, which is already present in the same `||` condition). It appears to be
a leftover from before the real RBAC's scope-tier design was settled. Whether to remove
it is noted in §8 as a small, low-risk frontend cleanup, not something this plan depends
on either way (`hasOrgScope()` alone already covers the case it was meant for).

## 4. Required backend work, derived from §3.1

For each area with no real backend today, the work is: a Django app (or apps — see §5.1)
owning the data, permission declarations, views enforcing them, and (for Shifts and
Penalisation) a new Next.js proxy route mirroring the existing
`createBackendProxyRoute(prefix)` one-liner pattern already used by
`leave`/`attendance`/`calendar`.

**Data each area needs to persist**, derived directly from the existing frontend
TypeScript contracts (`lib/api/leave.ts`, `lib/api/attendance.ts`, `lib/api/calendar.ts`)
for the three areas that have one, and from the frontend's local state shape
(`lib/attendance/{shifts,penalisation,dashboard}.ts`) for the three that don't:

- **Leave**: a leave type (name, category, annual allocation, carry-forward limit,
  requires-approval flag, paid flag, description, status — no user-entered code, per the
  explicit "no need for code" requirement already implemented in the frontend); a
  balance per employee per leave type per financial year (opening balance, allocated,
  used, pending, carry-forward, lapsed — `entitled`/`available` are derived, not
  separately stored fields, in the existing frontend type); a leave request (employee,
  type, date range, half-day option, reason, status, approver, timestamps).
- **Attendance**: a daily record per employee (clock-in/out times, working/late/early-
  leave/overtime minutes, status, source, notes) exactly matching the fields already on
  `AttendanceDayView`/`AttendanceRecord` in `lib/api/attendance.ts`; break sessions
  (needed to support "currently on break" and a running `break_minutes` total, both
  already fields on `AttendanceDayView`); a WFH/regularisation request (employee, type,
  date range, reason, status, approver, timestamps) matching `AttendanceRequest`.
- **Calendar**: a calendar entry (type: holiday/wfh/event, date, name, description) and
  a recurring WFH rule (weekday, label, active) — matches `CalendarEntry`/
  `RecurringWfhRule` in `lib/api/calendar.ts` exactly.
- **Shifts**: a shift (name, start time, end time, break minutes) and which employees
  are assigned to it — matches the frontend's `Shift { name, startTime, endTime,
  breakMinutes, employeeIds }` shape.
- **Penalisation**: the policy settings (regularisation grace period, absconding
  threshold, and for each of No Attendance/Late Arrival/Early Leaving/Work Hours: an
  enabled flag plus whatever numeric fields that rule needs, plus a Comp Off accrual
  enabled flag + rate) and a penalisation record per employee per absence (date,
  deadline, reason, status — applied/overturn_requested/overturned — overturn request
  reason/date, overturned-by/reason) — matches `PenalizationSettings`/
  `PenalisationRecord` in `lib/attendance/penalisation.ts` exactly.
- **Dashboard**: no dedicated storage. Every number on the Dashboard today (present/
  late/on-leave/WFH counts, weekly trend, leaderboard metrics, today's roster) is
  computed client-side over a roster; once Shifts/Attendance/Leave/Penalisation are
  real, the same client-side computation can run over real scoped data from those
  APIs instead of the sample roster — *if* the APIs above expose a scoped multi-employee
  list, which they don't yet (today's `attendanceApi.getHistory()`/`leaveApi.getRequests()`
  are self-only, by frontend design, since only the individual's own page ever called
  them). Whatever list read the Dashboard ends up using is additional API surface beyond
  what individual My Attendance/Leave pages need — flagged in §7 as needing a decision on
  shape, not assumed here.

**What is *not* required**: nothing above requires inventing frontend-facing behaviour
that doesn't already exist. Where the data model needs a field the frontend never
mentions (e.g. an internal primary key, a `created_at` timestamp), that's an
implementation detail, not a new requirement.

## 5. Structural questions this plan does not settle

### 5.1 Django app boundaries and count

The existing codebase has both a one-app-per-feature pattern (`example_leave`) and a
one-app-for-several-related-resources pattern (`payroll`, which owns several sub-
resources under one app with multiple routers). Nothing in the existing architecture or
the frontend dictates how many Django apps Attendance & Leave should be split into —
that's an implementation choice to make with whoever will own/review the code, guided by
whichever existing precedent fits best. This plan describes requirements by **frontend
feature area** (Leave, Attendance, Calendar, Shifts, Penalisation) rather than by
Python app name, and that grouping should not be read as a mandate to build exactly five
apps.

### 5.2 Approval-flow shape

Root `ARCHITECTURE.md`/`IMPLEMENTATION-PLAN.md` (outside `backend/`, and pre-dating
`example_leave`) describe a generic `approvals` app (`Request(request_type, requester,
approver, status, payload_json)`) intended to back every approval flow in the system.
It does not exist in the codebase. `example_leave` — the one actually-built, "copy this"
reference module — instead puts a `status` field and a custom `approve` `@action`
directly on the model itself, with no shared table.

Leave requests, WFH requests, regularisation requests, and penalisation overturn
requests all need *some* approve/reject mechanism. Two ways to get there exist in the
codebase's own history (one documented-but-unbuilt, one built-and-working) and this plan
does not pick between them:

- Follow `example_leave`'s pattern: each model gets its own `status` + custom actions.
- Build the documented generic `approvals` app first, and have every flow in this module
  route through it.

**Open decision** — affects the shape of every model in §4 that has a status/approval
step.

### 5.3 Scheduled/background work

Penalisation is described in the frontend as applying "automatically" once a
regularisation grace period lapses (no approval step) — that necessarily means
*something* evaluates this outside of any single HTTP request (nobody clicks a button
that raises it). The same is true for whatever finalizes a day's attendance status once
it's unambiguously over, and for crediting Comp Off accrual once overtime crosses a
threshold. No task queue, Celery, or cron mechanism exists anywhere in this repo today
(`docker-compose.yml`/`requirements.txt` confirmed clean of any).

**Open decision**: what triggers this work (a management command invoked by external
cron, a scheduled container, a task queue introduced for this purpose, or something
else), at what cadence, and exactly which moments need it beyond the three named above.
Nothing here proposes adding a new dependency to solve it.

### 5.4 Permission code reuse across app boundaries

The frontend already gates Shifts, Leave Types, Leave Balances-admin, and Policy
Settings behind the **same single string**, `attendance.settings.manage` — this is an
existing frontend fact (§3.2), not a proposal. If those four areas end up as separate
Django apps (§5.1), §2's registry rule ("a permission code has exactly one owning
registration," duplicate-but-identical registrations are harmless, conflicting ones
raise) means exactly one of them should register `attendance.settings.manage` and the
others should only reference the string in their own views' `required_permission`/
`write_permission`/`action_permissions` — not re-register it. Which app owns the
registration is an implementation detail to settle once app boundaries (§5.1) are
decided, not something this plan needs to fix now.

## 6. Permissions — minimum set required, mapped to the three access tiers

### 6.1 What the frontend already requires to exist

These four strings are already hardcoded in the frontend (§3.2) and gate real UI today,
even though no backend has ever registered them. Whatever this module builds, these
codes need to exist with these meanings for the frontend to keep working unmodified:

- `leave.approve` — gates the Leave tab in Approvals.
- `attendance.approve` — gates the WFH/Regularisation tabs in Approvals.
- `calendar.manage` — gates Calendar Management in Settings.
- `attendance.settings.manage` — gates Shifts, Leave Settings, and Policy Settings in
  Settings.

### 6.2 What the existing RBAC framework additionally requires to exist

Per §2 ("enforcement is mandatory"), every view exposing employee-owned reads/writes
needs a `required_permission` and (if it writes) a `write_permission` — this is forced
by `ScopedEmployeePermission`'s startup checks, independent of frontend gating. Since
the frontend never calls `hasPermission` for check-in/out, submitting leave, or viewing
one's own attendance/leave (§3.2), it gives no name or scope for these codes — they still
have to exist for the backend to function, but their exact naming is free. This plan
does not fix names for them beyond noting they're needed; whoever builds the module can
follow the `example_leave` convention (`<module>.read` / `<module>.write`) since that's
the only existing precedent, without that choice being dictated by a frontend
requirement.

The Penalisation review actions (Approvals → Penalisation) currently have **no**
permission gate at all (§3.2) — some new permission code will be needed there too, for
the same reason: the endpoints have to declare something, and "visible to anyone who can
see Approvals" (today's frontend comment) stops being an accurate description once the
data is real and scope-checked per employee rather than a fixed sample.

### 6.3 Mapping to the three specified access tiers

This is the one part of the permission design that *is* an explicit requirement (given
directly in the task), not a derived one:

| Tier | Frontend sections | Requires holding, at minimum |
|---|---|---|
| Basic Employee | My Attendance only (Attendance, Leave Management, Calendar) | Whatever self-scoped read/write codes back the individual's own attendance/leave actions (§6.2) — no `*.approve`, no penalisation-review code, no `calendar.manage`, no `attendance.settings.manage` |
| Admin / Team Manager | Dashboard for their team/reports, My Attendance, Approvals for their team/reports | Everything Basic Employee has, plus `leave.approve` / `attendance.approve` / the new penalisation-review code, each scoped to the manager's reports — no `calendar.manage`, no `attendance.settings.manage` |
| HR Manager | Everything, including Settings | Everything above at the broadest scope, plus `calendar.manage` and `attendance.settings.manage` |

This maps onto the already-seeded `Employee` / `Manager` / `HR Admin` roles with no new
roles required — "Admin / Team Manager" and "HR Manager" are the task's names for tiers
that already correspond to the existing `Manager` and `HR Admin` roles.

**What scope tier "their team/reports" resolves to (`manager` vs. `team`) is not fixed
by this plan.** `ScopeTier.MANAGER` (direct reports only) and `ScopeTier.TEAM` (full
recursive subtree) both exist and are both usable today; the task's own wording
("reportees," "their team") doesn't disambiguate a manager-of-managers case, and the
frontend has no multi-level reporting UI to test against either way. **Open decision**,
same as §5.2/§5.3 in kind — pick one when assigning `default_grants` in whichever app(s)
register these permissions.

## 7. Open decisions — frontend does not define these; not to be treated as settled

Each of these was presented as a resolved default in the prior draft. None of them are
implied by the frontend, the existing backend, or an explicit instruction — they need an
actual decision before the relevant piece of backend logic is written.

1. **Approval-flow shape** (§5.2): self-contained status+action per model, vs. a
   generic `approvals` app.
2. **Scheduled-job design** (§5.3): trigger mechanism, cadence, infra.
3. **Attendance status derivation**: when an employee is on leave *and* it's a holiday,
   *and/or* the weekend, *and/or* an org WFH day, which status wins, and in what order —
   the frontend's mock fills days with a plausible-looking status but never had to
   reconcile overlapping conditions against real data, so there is no existing
   precedence to preserve.
4. **Half-day interaction**: `LeaveRequest.half_day_option` (`first_half`/`second_half`)
   already exists in the frontend contract, but how a half-day leave interacts with the
   same day's attendance record (partial clock-in expected? none?) is not specified
   anywhere in the frontend.
5. **Comp Off accrual mechanics**: the frontend's Policy Settings has an enabled flag and
   an "N overtime hours = 1 Comp Off" rate — but not *when* that's evaluated (rolling
   daily total? weekly? monthly?) or *how* a credited day is applied (added to a Comp
   Offs leave balance the same way any other allocation is, or tracked separately). The
   frontend never performs this calculation anywhere; it's a description of a policy,
   not an implemented computation.
6. **Penalisation's leave-day deduction**: "1 day leave deducted for every no-attendance
   day" is, today, read-only descriptive text in the frontend (the Policy Settings
   sentence and the read-only Attendance Policy popup) — no UI anywhere actually performs
   a deduction against a specific leave balance. Whether raising a `PenalisationRecord`
   should perform a real balance deduction, and if so against which leave type, is
   undefined by the frontend.
7. **Absconding behaviour**: the frontend's Policy Settings has an "absconding
   threshold" (consecutive absent days), but nothing in the frontend shows what happens
   once it's crossed beyond the setting existing — no UI reads or reacts to an
   "absconded" state anywhere. Whether this should affect `Employee.status` (which today
   only has `active`/`on_leave`/`exited`, defined in `core/enums.py`, outside this
   module) is undefined, and any change to that shared enum would need to be treated as
   a deliberate, separately-agreed core change (§1), not something this module decides
   unilaterally.
8. **Manager vs. team scope** (§6.3): whether "their team/reports" means direct reports
   (`ScopeTier.MANAGER`) or the full recursive subtree (`ScopeTier.TEAM`).
9. **Dashboard/Leaderboard's read shape** (§4, last bullet): today's individual-scoped
   endpoints (`GET /attendance` for one's own history, `GET /leave/requests` for one's
   own requests) don't serve a "give me my team's data" query — some new read surface is
   needed, but its exact shape (a dedicated multi-employee list endpoint vs. an
   `employee_id`/scope parameter on the existing endpoints vs. something else) isn't
   dictated by the frontend, which currently gets this data from a fake in-memory roster
   rather than any API call at all.
10. **Duplicate holiday data**: the frontend has two independent read paths for holiday
    information — `leaveApi.getHolidays(year)` (consumed by the pre-existing, separate
    `/calendar` company-wide page and a Home-dashboard widget, both outside Attendance &
    Leave, but sharing the `/leave` proxy prefix) and `calendarApi.getEntries({type:
    'holiday'})` (the Calendar Management feature inside this module). Whether the real
    backend should back both from one source of truth or keep them as genuinely separate
    concepts is not specified — worth resolving before building either, to avoid two
    holiday lists that can silently disagree, but the resolution itself isn't decided
    here.

## 8. Frontend changes that will be needed regardless of the open decisions above

These are mechanical consequences of moving off mock data, not new design:

1. New Next.js proxy routes for Shifts and Penalisation (same
   `createBackendProxyRoute(prefix)` pattern already used for `leave`/`attendance`/
   `calendar` — no new pattern to invent).
2. `lib/attendance/shifts.ts` and `ShiftsSettingsPanel.tsx`'s employee picker: replace
   the local `useState`/`SAMPLE_SHIFT_EMPLOYEES` sample data with a real API client and
   the existing, already-real `/api/v1/employees` list (Shifts should not get its own
   duplicate employee directory).
3. `lib/attendance/penalisation.ts`: replace the `localStorage`-backed
   `usePenalisations`/`usePenalizationSettings` hooks with a real API client; every
   consumer (`AttendancePolicyModal`, `PenalizationSettingsPanel`, the Leave Management
   Penalisations block, the Approvals Penalisation tab) keeps its current shape, just
   fed from the network instead of `localStorage`.
4. `approvals/page.tsx`: add a permission gate to the Penalisation tab/actions, since
   §3.2 confirms it currently has none — the exact code depends on §6.2/§7 item 1.
5. `lib/attendance/dashboard.ts` / `AttendanceLeaderboard.tsx`: replace the sample-roster
   generation with real aggregation, once §7 item 9 decides what that reads from.
6. `lib/attendance/sample-employees.ts`: removable once Shifts and Dashboard both read
   the real employee directory.
7. Optional, no functional effect either way: the vestigial `'scope.all'` string noted
   in §3.2.
8. **No change needed** to `leave/page.tsx`, `me/attendance/page.tsx`,
   `CalendarManagementPanel.tsx`, or Approvals' existing Leave/WFH/Regularisation
   sections — they already call real `leaveApi`/`attendanceApi`/`calendarApi` clients
   against the existing proxy routes; once the real backend implements that already-fixed
   contract, the only change for them is turning off `MOCK_AUTH` for these prefixes.

## 9. Practical, dependency-based build order

This orders work by what depends on what, without prescribing app boundaries (§5.1) or
resolving the open decisions (§7) — those need answers first for the phases that touch
them.

1. **Resolve §7's open decisions** (or at least the ones each phase below touches)
   before starting that phase.
2. **Calendar** — no dependency on anything else in this module; needed early because
   Attendance's status derivation (§7 item 3) will read from it once that's decided.
3. **Shifts** — no dependency on anything else; needed before Attendance's late/early/
   overtime computation can be implemented (once §7 item 3 is resolved), since that
   computation is relative to an employee's assigned shift.
4. **Leave** (types, balances, requests) — types and balances can start immediately;
   requests interact with balances and (once §7 item 4 is resolved) with attendance.
5. **Attendance** (records, breaks, requests) — depends on Calendar and Shifts for
   status derivation, and on Leave for on-leave status, so naturally lands after both,
   once §7 items 3–4 are resolved.
6. **Penalisation** — depends on Attendance (absence facts) and, if §7 item 5/6 decide
   to touch leave balances, on Leave — plus whatever §7 items 1 and 2 decide for its
   approval/overturn flow and its triggering mechanism.
7. **Dashboard/Leaderboard frontend wiring** — depends on whatever §7 item 9 decides for
   the team-scoped read shape, and on Attendance/Leave/Penalisation existing to read
   from.
8. **Frontend cutover** (§8) and turning off `MOCK_AUTH` for these prefixes, once each
   piece above is verified end to end (§10).

## 10. Testing & end-to-end verification

- Follow the existing conformance pattern documented in `MODULE-GUIDE.md` and
  implemented in `example_leave/` for every new permission-gated view: it already
  verifies (mechanically, via `assert_module_conforms`/`run_conformance`) that
  permissions are registered, anonymous requests get 401, permission-less requests get
  403, every scope tier returns exactly the right set of records on a list, in-scope
  detail records open and out-of-scope ones 403, a per-user override beats a role grant,
  writes require the write permission, the record's owner always comes from the
  authenticated user rather than the request body, and every custom action is
  individually permission-checked. This is existing infrastructure, not new work to
  design.
- Additional targeted tests per area, once §7's relevant decisions are made: a
  concurrency test on leave balance updates (two simultaneous submissions can't
  over-draw a balance — flagged in the pre-existing root `IMPLEMENTATION-PLAN.md` for
  this exact model, independent of this plan); whatever precedence rule §7 item 3
  settles on, tested case by case; idempotency of whatever scheduled mechanism §7 item 2
  settles on.
- End-to-end pass against §3.1's inventory table, one row at a time, logged in as each
  of the three tiers separately, confirming §6.3's table holds exactly — this is the
  acceptance test for "the frontend is the source of truth" actually being satisfied,
  not just individual endpoints working in isolation.
- Existing repo-wide checks (`manage.py check`, `ruff check .`, `black --check .`,
  `pytest`) — unchanged, already required by `MODULE-GUIDE.md`'s checklist.

## 11. Explicitly out of scope

- Anything not present in the current frontend, added because it would be generically
  useful (configurable weekly-offs, multi-level org-chart rollups beyond whatever §7
  item 8 resolves to, a notification system, an audit UI beyond the existing
  `write_audit` primitive) — none of this is requested by any current screen.
- Redesigning the pre-existing, separate `/calendar` company-wide page or the Home
  dashboard's holiday/leave widgets — they incidentally share the `/leave` proxy prefix
  (§7 item 10) and this plan's `leave` work needs to keep serving them, but their own UX
  is owned elsewhere.
- Any change to `core/`, `accounts/`, or `employees/` — §1, plus the specific case in §7
  item 7 (absconding), which is flagged rather than assumed.
