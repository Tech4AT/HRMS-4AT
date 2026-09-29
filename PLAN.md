# Attendance & Leave — Backend Implementation Plan

Status: **Steps 1–12 are all built, tested, and verified live** (Calendar,
Attendance, Leave, the cross-cutting Approvals integration, Shifts/Policy
Settings, Penalisation, the Dashboard's real scoped data, RBAC/scope
verification, API/proxy integration, and the final testing/verification pass —
plus a post-Step-6 comprehensive bug audit and post-Step-6 manual-verification
fixes, both recorded in their own sections below). **Step 7 (Leave balances &
accruals)** is now fully built too: opening-balance seeding and carry-forward
were done earlier; Comp Off accrual's two open decisions (when it's evaluated,
how a credit is applied) were resolved by direct instruction and built as the
final piece of this plan — see Step 7's own section for the resolution and
what was built.

## Revision note

This supersedes the previous revision, written before `origin/RBAC` (which added
the generic `backend/approvals` engine, `backend/notifications`, `backend/documents`,
and a reworked frontend nav/Approvals page) was merged into this branch
(commit `fa9cb01`). Three things changed as a result, and this revision exists
specifically to reflect them:

1. **The approval-flow question is no longer open.** The previous revision's §5.2
   presented "per-model status+action" vs. "a generic approvals app" as an
   unresolved choice. It is resolved: `backend/approvals` exists, is merged, has a
   working reference consumer (`example_leave`), and `docs/LEAVE-ATTENDANCE-INTEGRATION.md`
   explicitly mandates building on it. That subsection is removed; §5/Step 5 below
   states the settled architecture instead.
2. **Calendar (Step 2) is no longer future work.** It was fully implemented,
   tested (24 tests), and verified end-to-end through the real frontend proxy
   during this branch's development, then merged. Step 2 below documents it as
   **built**, not planned.
3. Every other genuinely-open item from the prior revision (scheduled-job design,
   attendance status precedence, half-day interaction, comp-off mechanics,
   penalisation deduction, absconding behaviour, manager-vs-team scope, dashboard
   read shape, duplicate holiday data) is still open — nothing in the merge
   settled any of these — and is carried forward, attached to the step it affects.

Re-verified directly against current source for this revision: `backend/approvals/{models,service,signals,views,rbac}.py` and `README.md`,
`backend/example_leave/{models,views,handlers,apps,rbac}.py`, `docs/LEAVE-ATTENDANCE-INTEGRATION.md`,
`backend/org_calendar/` in full (confirmed intact post-merge), `backend/config/settings/base.py`'s `INSTALLED_APPS`,
`frontend/src/app/(app)/layout.tsx` (post-merge nav), `frontend/src/lib/api/requests.ts`.

---

## 0. Ground rules (unchanged)

`backend/core/`, `backend/accounts/`, and `backend/employees/` are read from,
never edited. Every requirement below is expressed in terms of what a *new*
plugin app can declare and use — `<app>/rbac.py`, `required_permission`/
`write_permission`/`action_permissions` on views, `approvals.create_request()` +
a `request_decided` receiver, an `employee` FK on employee-owned models — not in
terms of a core change. `backend/approvals`, `backend/notifications`, and
`backend/documents` are also now core-adjacent primitives (docs/ARCHITECTURE.md's
numbering: #3/#5/#6) with the same "build on it, don't edit it" status as
`core`/`accounts`/`employees` — this plan's modules are consumers of `approvals`,
never contributors to it.

---

## Step 1 — Existing infrastructure & architecture verification

**This step is a checkpoint, already satisfied as of `fa9cb01`.** It's kept as
Step 1 because every later step depends on these facts being true; re-check them
if this plan is picked up much later and the codebase has moved on.

### 1.1 Plugin wiring (`backend/config/api_urls.py`)

Any app in `INSTALLED_APPS` that isn't `employees`/`accounts` gets its
`<app>/api_urls.py` auto-mounted under `/api/v1/`. Adding a module = add to
`INSTALLED_APPS` + ship `api_urls.py`. No other core file changes. Confirmed
still true; `org_calendar` is the second working proof after `example_leave`.

### 1.2 RBAC mechanics (`core/registry.py`, `core/permissions.py`, `core/enums.py`)

Unchanged from before the merge — the RBAC engine (`Role`/`Permission`/
`RolePermission`/`UserPermissionOverride`, `ScopeTier`, `ScopedEmployeePermission`,
`HasPermissionCode`, the `core.E001`–`E004` startup checks) predates this merge
and was not touched by it. See Step 10 for the permission set this plan needs.

### 1.3 The Approvals Engine — now built, merged, and the mandated pattern

`backend/approvals` is a small, generic, already-working app:

- **Model**: `Request(id: uuid, request_type: str, requester, approver, status,
  payload: JSONField, decision_note, decided_by, decided_at, created_at, updated_at)`.
  `status ∈ {pending, approved, rejected, withdrawn}`; pending is the only
  non-terminal state; a terminal request never transitions again.
- **`approvals.service.create_request(requester_user, request_type, payload,
  approver_user=None)`** — raises a request. `approver` defaults to the
  requester's manager's user account (`employee.manager.user`); `None` if the
  requester has no manager (HR reassigns via the escape hatch below). Notifies
  the approver and writes an audit entry. **Your module calls this and nothing
  else on the write side of approval.**
- **Decisions happen through the engine's own endpoints, not your module's**:
  `POST /api/requests/{id}/approve|reject|withdraw` (approver-only / requester-only
  respectively), plus `reassign`/`resolve` gated by `approvals.manage` (HR Admin +
  Finance, `ScopeTier.ALL`) as the stuck-request escape hatch. `GET /api/requests`
  lists what the caller raised or must approve (or everything, with `approvals.manage`).
  **Your module writes none of this.**
- **`approvals.signals.request_decided`** — fired once, after the transition is
  persisted, with `(request, actor, status)`. This is the *only* way a module
  finds out its request was decided, since the decision happens through the
  generic endpoint, outside the module's own call path. Connect a `@receiver` in
  `apps.py::ready()`, filter on `request.request_type`, apply the effect.
- Every transition (`create`, `approve`, `reject`, `withdraw`, `resolve`) is
  audit-logged and notifies the affected party automatically — nothing to build.
- What is explicitly **not** the engine's job, i.e. still this plan's work:
  domain validation (overlaps, balance sufficiency) before raising, domain data
  (leave types, balances, calendar, shifts), and applying the decision's effect
  inside the signal receiver.

**The settled decision** (was open in the previous revision, §5.2 — now removed):
Leave, WFH, and Attendance Regularisation requests are raised via
`approvals.create_request()` and resolved via the generic engine + `request_decided`
signal. **No module in this plan writes its own approve/reject endpoint, status
transition table, or notify/audit call for these three flows.** The flow is:

```
Leave/WFH/Regularisation request
  → approvals.create_request(user, request_type, payload)
  → Approvals Engine (routes to manager, exposes approve/reject/withdraw)
  → manager decides via POST /api/requests/{id}/approve|reject
  → request_decided signal fires
  → this module's @receiver applies the decision to its own row
```

**Penalisation is the deliberate exception.** It has no raise/route/decide shape
in the frontend at all — it auto-applies once a grace period lapses, and the
only "decision" a human makes is HR directly overturning one, which today
(Approvals → Penalisation tab, `lib/attendance/penalisation.ts`) is a plain
two-state record (`applied` → `overturned`), not a raise-then-decide flow with
a routed approver. **An employee cannot request an overturn** — corrected
during manual verification (post-Step 7): the original design let an employee
submit an overturn request from Leave Management for HR to approve/reject
(`applied` → `overturn_requested` → `overturned`); the project owner rejected
this — an employee only ever sees whether they've been penalised, read-only,
and only HR decides an overturn, directly. **Do not force Penalisation onto
`approvals.Request`.** Keep its existing domain-specific lifecycle as its own
model with its own status field and its own permission-gated overturn action
(Step 8). If a future requirement reintroduces an employee-initiated overturn
request, that's a deliberate, separately-agreed change — not something this
plan does by default.

### 1.4 Reference implementations to copy from

Two working precedents now exist, covering different halves of what this plan needs:

- **`backend/example_leave/`** — the approvals-engine consumer pattern.
  `LeaveRequest.employee` FK, `perform_create()` calls `approvals.create_request()`
  after saving its own row, `handlers.py`'s `@receiver(request_decided)` applies
  the decision (`approved`/`rejected`/`withdrawn` → its own `status` field),
  registered in `apps.py::ready()`. This is the pattern Steps 3 and 4 copy for
  Attendance and Leave.
  - **One inconsistency worth knowing before copying**: `example_leave/views.py`
    still has a custom `approve` `@action` and `example_leave/rbac.py` still
    registers `example_leave.approve` — both predate the approvals-engine
    migration and are now vestigial (calling that action sets `status="approved"`
    directly, bypassing `approvals.decide()` entirely, leaving the corresponding
    `Request` row stuck `pending` forever). `backend/MODULE-GUIDE.md`'s own
    narrative text also still teaches the old own-approve-action pattern and
    hasn't been updated for the engine. **Follow `handlers.py` +
    `docs/LEAVE-ATTENDANCE-INTEGRATION.md` + `approvals/README.md` as the
    authoritative pattern; don't copy the leftover `approve` action or
    `example_leave.approve`-style permission for Leave/WFH/Regularisation.**
- **`backend/org_calendar/`** — the flat, non-employee-keyed CRUD pattern (Step 2,
  built). `HasPermissionCode` (one code, no scope filtering) instead of
  `ScopedEmployeePermission`, a local `EnvelopeMixin` for full-CRUD `{success,
  data}` envelopes + audit wiring, `DefaultRouter(trailing_slash=False)`. Steps 6
  (Shifts/Policy Settings) and parts of Step 8 (Penalisation policy settings) copy
  this pattern, since that data isn't employee-keyed either.

### 1.5 Frontend contract inventory (unchanged by the merge, still the source of truth)

| Feature area | Frontend location | Current data source |
|---|---|---|
| Check-in/out, breaks, attendance log, history, summary | `/me/attendance` | Mock (`lib/api/mock-data.ts`) via real proxy at `/api/attendance/*`; contract in `lib/api/attendance.ts` |
| WFH & regularisation requests (submit/cancel/edit/own list) | inside `/me/attendance`, `/attendance/wfh`, `/attendance/regularize` | Same, `/api/attendance/requests*` |
| Leave types (read), requests, own balance | `/leave` | Mock, `/api/leave/*`, contract in `lib/api/leave.ts` |
| Org calendar CRUD (holidays/WFH days/events, recurring WFH rule) | Settings → Calendar Management | **Real** — `org_calendar`, `/api/calendar/*`, contract in `lib/api/calendar.ts` |
| Read-only personal+org calendar view | My Attendance → Calendar | Client-side composition over `attendanceApi.getHistory()`, no dedicated endpoint |
| Leave Types CRUD | Settings → Leave Settings → Leave Types | Mock; `POST/PUT/DELETE /api/leave/types` were added to the mock in this project, never had a real backend |
| Leave Balances (view + admin edit) | Settings → Leave Settings → Leave Balances | Frontend-only sample data, no API client |
| Shifts (create, assign employees) | Settings → Shifts | Frontend-only `useState`, no API client |
| Penalisation + Policy/Penalization Settings | Approvals → Penalisation, Settings → Policy Settings, My Attendance → Attendance Policy popup | Frontend-only, `localStorage`-backed, no API client |
| Dashboard (KPIs, weekly trend, leaderboard, roster) | Attendance → Dashboard | Frontend-only deterministic sample data, no API client |
| Generic approvals inbox (To approve / My requests) | `/approvals` | **Real** — `backend/approvals`, `/api/requests/*`, contract in `lib/api/requests.ts` |

`leave`/`attendance`/`calendar` already have a fixed request/response contract to
build behind; Leave Balances, Shifts, Penalisation, and Dashboard have no backend
concept and no API client yet — including the Next.js proxy route itself where
one is needed (Step 11).

### 1.6 Frontend gating, post-merge (re-verified against current `layout.tsx`)

```
{ id: 'approvals',  label: 'Approvals',  href: '/approvals',            roles: [...] /* no permission gate on the item itself */
    children: [ 'To approve', 'My requests', 'Penalisation' ] }
{ id: 'attendance', label: 'Attendance', href: '/attendance',           roles: [...]
    children: [
      { 'Dashboard',     requireAnyPermission: ['leave.approve','attendance.approve','scope.all'] },
      { 'My Attendance', matchPrefixes: ['/attendance','/me/attendance','/leave'] }  // no permission gate
      { 'Settings',      requireAnyPermission: ['attendance.settings.manage','calendar.manage'] },
    ] }
```

Within `attendance/settings/page.tsx`: `attendance.settings.manage` gates Shifts,
Leave Settings (Types + Balances), and Policy Settings; `calendar.manage` gates
Calendar Management separately (already real, Step 2). Within `approvals/page.tsx`:
`leave.approve` and `attendance.approve` gate the Leave and WFH/Regularisation
tabs. **The Penalisation tab still has no permission gate of its own** — carried
forward unchanged from the prior revision, still true post-merge, still needs a
real code once Penalisation is real (Step 8/10).

`grep -n "hasPermission"` on `leave/page.tsx` and `me/attendance/page.tsx` still
returns zero matches — self-service Leave/Attendance is gated only by being an
authenticated user, not by any specific permission code. This still means the
backend needs *some* permission code for these actions (RBAC enforcement is
mandatory regardless of frontend gating), but the frontend gives no naming/scope
signal for it (Step 10).

The vestigial `'scope.all'` string in the Dashboard gate and `mock-auth.ts` is
still present, still not part of the real RBAC vocabulary, still a low-priority
optional cleanup (Step 11), not a blocker.

### 1.7 Definition of done for this step

- [x] `backend/approvals` exists, is in `INSTALLED_APPS`, its tests pass.
- [x] `backend/org_calendar` exists, is in `INSTALLED_APPS`, its 24 tests pass, verified live through the real proxy as both HR Admin and Employee.
- [x] `example_leave` demonstrates the full raise → decide → signal → apply cycle.
- [x] Frontend contracts for Leave/Attendance/Calendar/Requests are stable and read.
- [ ] Nothing further — proceed to Step 2.

---

## Step 2 — Calendar backend (built)

Kept here, in order, as a record of what's done — not a task list.

**Amended in Step 4**: `WeekOff(weekday 0–6, active)` was added — same shape
and permission as `RecurringWfhRule` — because Step 3's attendance status
derivation had hardcoded Saturday/Sunday as the weekend, and the project owner
flagged that week-off must be HR-configurable, not assumed. A data migration
seeds Saturday+Sunday as the default so this didn't silently change existing
behaviour. See Step 4's own notes for the full story.

- **Models** (`org_calendar/models.py`): `CalendarEntry(type: holiday|wfh|event,
  date, name, description, created_at, updated_at)`; `RecurringWfhRule(weekday
  0–6, label, active, created_at, updated_at)`, label auto-derived from weekday
  if blank; `WeekOff(weekday 0–6, active, created_at, updated_at)`.
- **CRUD**: full CRUD on all three, `DefaultRouter(trailing_slash=False)` at
  `calendar/entries`, `calendar/recurring-wfh`, and `calendar/week-off` (Python
  app named `org_calendar` to avoid shadowing stdlib `calendar`; URL prefix
  stays `calendar/...` to match the frontend's existing proxy).
- **API endpoints**: matches `lib/api/calendar.ts`'s `calendarApi` exactly, incl.
  `from`/`to`/`type` filtering on entries. `WeekOff` has no frontend client yet
  (nothing built one — it's new, Step 4-driven); it's reachable and tested via
  the API directly.
- **RBAC**: one flat permission, `calendar.manage` (`HasPermissionCode`,
  `default_grants={"HR Admin": ScopeTier.ALL}`), now also covering `WeekOff` —
  not employee-keyed data, so one code covers every action, no separate
  read/write split.
- **Approvals integration**: none — pure admin CRUD, no request/decision concept.
- **Notifications/audit**: every create/update/destroy calls `write_audit` via a
  local `EnvelopeMixin`; no notification (not a request to anyone).
- **Tests**: 31 tests (24 original + 7 for `WeekOff`) — permissions incl.
  401/403, CRUD, filters, PUT-as-partial, audit-log assertions, RBAC wiring.
- **Definition of done**: met — verified live via the real frontend proxy as HR
  Admin (full CRUD) and as an Employee test account (403 on all calendar-manage
  actions); `WeekOff` verified via its own test suite (no frontend UI for it
  yet to smoke-test live against).

---

## Step 3 — Attendance backend (built)

The single-value status-precedence question this step originally flagged as
open was **replaced, not resolved as originally framed** — the project owner
rejected collapsing-to-one-status as the right model entirely and specified an
overlay + explicit-conflict-rules design instead (below). Kept here, in order,
as a record of what's built.

### Models (`backend/attendance/models.py`)

- `AttendanceRecord`: `employee` FK, `attendance_date`, clock-in/out timestamps,
  `working_minutes` (computed net of breaks at check-out; late/early/overtime
  left `null` until Shifts — Step 6 — exist to compute against), `status`
  (present/work_from_home/half_day/absent/not_marked — **this is only the
  record's own clock-in-derived state**, not the day's full picture), `source`,
  `notes`, `marked_by`. One row per employee per day (unique constraint).
- `BreakSession`: `attendance_record` FK, start/end timestamps; `end_time=None`
  means in progress. `.minutes` property counts an in-progress break too.
- `AttendanceRequest`: `employee` FK, `request_type` (wfh | regularisation),
  date range, `reason`, `status` (submitted/approved/rejected/cancelled),
  `decided_at`. **No `approver` field, no approve/reject action** —
  `approval_request` links to the one `approvals.Request` row that actually
  gets decided (Approvals integration below).

### The overlay model (`day_facts.py`) — not a single collapsed status

Per explicit instruction, a date's facts are **independent overlays that can
coexist**, computed once in `attendance/day_facts.py::get_day_facts(date)` and
reused by both request validation and the day-view response (one source of
truth, not two copies that can drift):

- `is_weekend` (Sat/Sun — plain calendar for now; a shift-based custom working
  week doesn't exist yet, Step 6)
- `is_holiday` / `holidays` (from `org_calendar.CalendarEntry(type=holiday)`)
- `events` (from `CalendarEntry(type=event)`) — **always informational, never
  conflicts with anything, always returned regardless of what else is true**
- `is_org_wfh_day` (one-off `CalendarEntry(type=wfh)` or an active
  `RecurringWfhRule` for that weekday)
- `is_on_leave` / `leave_type_name` — **placeholder, always `False`/`None`
  until Leave (Step 4) exists**; the shape is here so Step 4 only extends this
  one function, not every caller.

None of these "win" over another here — `get_day_facts()` never picks one.

### Explicit conflict rules (`conflicts.py`) — validated at request creation

Applied in `AttendanceRequestViewSet.create()`, **before** a row is created and
before `approvals.create_request()` is ever called — an invalid request never
reaches the approvals engine:

1. **Holiday blocks WFH and Regularisation** (the given instruction, verbatim;
   Regularisation gets the same rule by direct symmetry — neither request
   makes sense on a day nobody was expected to work).
2. **Weekend gets the same treatment as Holiday**, for the same reason.
3. **An event never blocks anything** — always shown independently regardless
   of the day's other facts (Holiday + Event is explicitly valid, per instruction).
4. A new WFH/Regularisation request **cannot overlap** the same employee's own
   existing submitted-or-approved WFH/Regularisation request.
5. Regularisation additionally requires the day to have **no existing
   clock-in** — rejected at creation, not silently ignored at decision time
   (the original design silently no-op'd this at approval; fixed).
6. **Judgment call, flagged as one**: a multi-day WFH request failing on *any*
   day in its range rejects the *whole* request (naming the first offending
   date), rather than trimming itself to the valid days.
7. **Judgment call, flagged as one**: an org-wide WFH day does *not* block a
   personal WFH request for the same date — the two aren't contradictory.

**Not yet applicable — PLAN.md Step 4 (Leave doesn't exist yet), noted in
`conflicts.py` for whoever builds it:**
- Leave should block WFH/Regularisation for the same date once Leave exists.
- Leave should be **allowed** to span a holiday (an ordinary multi-day leave
  request commonly does) — unlike WFH/Regularisation, this should *not* be
  rejected. What the day-view's single `status` field then shows for that one
  overlapping day (see below) is a still-open display question for Step 4.

### The day-view response (`day_view.py`) — overlays stay independent, `status` still picks one for display

`GET /attendance` (history), `/attendance/today`, `/attendance/summary` all
return every overlay field independently and honestly (`is_holiday`,
`is_weekend`, `on_leave`, `is_wfh_day`, `events`, plus the raw
`AttendanceRecord` fields) — nothing is hidden to make room for `status`.
`status` itself is still exactly one value because the existing, frozen
frontend contract requires it (`MyAttendanceCalendar.tsx`'s `toAttendanceRow()`
switches directly on `v.status`, not on the booleans) — so a choice is
unavoidable there specifically. That choice is narrow and explicit, not
arbitrary: since conflict rules above mean Holiday/Weekend can never coexist
with an *approved* WFH/Regularisation, the only way they coexist with a
clock-in at all is a voluntary check-in on a day off — Holiday, then Weekend,
win `status` in that case, while `check_in`/`check_out`/`working_minutes`
still populate regardless (the fact isn't lost, just not what `status` leads
with). Documented in `day_view.py`'s own docstring, including the Leave/Holiday
display question this doesn't yet have to answer (Leave doesn't exist yet).

### CRUD / API endpoints (all built, matching `lib/api/attendance.ts` exactly)

`GET /attendance` (history, `?from=&to=` or `?month=`), `/attendance/today`,
`/attendance/summary`; `POST /attendance/check-in`, `/check-out`,
`/break-start`, `/break-end`; `/attendance/requests` list/create/patch,
`/requests/{id}/cancel`, `/requests/approvals/pending` (manager-scoped, read-only).

### RBAC

- `attendance.read` / `attendance.write` (`ScopedEmployeePermission`,
  `Employee`/`Manager`/`HR Admin`→`SELF`/`MANAGER`(read)/`ALL` — no frontend
  name was dictated, so this follows `example_leave`'s convention, per §6.2).
- `attendance.approve` — already a hardcoded frontend nav-gate string (1.6).
  The approvals engine's own decision endpoints don't consult it (deciding
  only requires being the named approver). Here it scopes the read-only
  `/requests/approvals/pending` list (used by the Dashboard's pending count)
  to a manager's reports — a real, narrower role than "gates a nav tab," not
  a no-op.

### Approvals integration

`request_type` strings `"wfh"` and `"attendance_regularization"`, raised via
`approvals.create_request()` in `AttendanceRequestViewSet.create()` *after*
`conflicts.py`'s validation passes. `handlers.py`'s `@receiver(request_decided)`
mirrors `example_leave/handlers.py`: updates `AttendanceRequest.status` and, on
approval, marks the covered day(s) Work From Home or Present — never
overwriting a day that already has a real clock-in. **No approve/reject
endpoint exists in this app.**

### Notifications / audit

Free from the engine for the request lifecycle. Direct mutations (check-in/
out, break start/end, request create/update/cancel) call `write_audit` directly.

### Tests (49 tests, all passing)

`test_rbac_wiring.py` (registration + startup checks), `test_check_in_out.py`,
`test_attendance_requests.py` (CRUD, scope, cancel-via-withdraw), 
`test_approvals_integration.py` (mirrors `example_leave`'s: routes to manager,
decision flows back via signal, rejection/withdrawal, marks the right days,
never overwrites an existing clock-in, ignores other modules' decisions),
`test_day_facts_and_conflicts.py` (the overlay/conflict rules in isolation),
`test_day_view_endpoints.py` (today/history/summary/break, incl. "holiday
status doesn't hide a voluntary clock-in").

### Definition of done — met

Self-service check-in/out/break and history/summary match the frontend
contract exactly; WFH/Regularisation requests are validated against explicit
conflict rules *before* raising, then raise through `approvals.create_request()`
and resolve through the generic engine with no bespoke approve endpoint in this
module; all overlay facts are independently correct and never collapsed away;
`manage.py check`, `ruff`, `black`, and the full repo test suite (377 tests)
pass. Not yet done, deferred to when their dependency exists: Leave↔Holiday
interplay for `status` display (Step 4), late/early/overtime minutes (Step 6,
needs Shifts), and the day-finalization scheduled job (Step 7).

---

## Step 4 — Leave backend (built)

Two things surfaced while building this step corrected earlier work rather
than just extending it — recorded here, in order, along with what's built.

### Correction to Step 3: week-off is HR-configurable, not hardcoded Sat/Sun

Flagged by the project owner directly: "weekend should not automatically be
considered holiday — week off should be configurable by HR admin." Step 3's
`day_facts.py` originally hardcoded `date.weekday() >= 5`. Fixed by adding
**`org_calendar.WeekOff`** (`weekday` 0–6 Sunday-first, `active` — same shape
as `RecurringWfhRule`, same `calendar.manage` permission, CRUD at
`/calendar/week-off`), with a data migration seeding Saturday+Sunday as the
default so existing behaviour doesn't silently change for nobody's benefit.
`day_facts.DayFacts.is_weekend` (the field name stays, to match the frontend
contract) now reads this instead. Deliberately simple: one org-wide,
non-alternating weekly pattern — a shift-based or team-specific week-off is
out of scope here (Step 6, if ever needed).

### Models (`backend/leave/models.py`)

- `LeaveType`: name, `code` (auto-derived from name, e.g. `name[:3].upper()`
  with a numeric-suffix collision fallback — matches the retired mock's exact
  rule; never accepted from the request body), category (fixed set matching
  `LeaveSettingsPanel.tsx`'s `CATEGORY_OPTIONS`), annual allocation,
  carry-forward limit, requires-approval flag, paid flag, description, status
  (present for contract parity, never actually toggled by any UI — confirmed
  by grep, same as the vestigial `'scope.all'` string elsewhere).
- `LeaveBalance`: `employee` FK, `leave_type` FK (`PROTECT`), `financial_year`
  (a plain calendar-year string, e.g. `"2026"` — matches the retired mock's
  exact format, no April–March fiscal offset assumed), opening/allocated/used/
  pending/carry-forward/lapsed. `entitled`/`available` are derived properties.
  **Lazily created** on first reference, seeded from the type's current
  `annual_allocation` — proration, accrual timing, and carry-forward
  computation are explicitly Step 7's job, not this one.
- `LeaveRequest`: `employee` FK, `leave_type` FK (`PROTECT`), date range,
  `half_day_option`, reason, `status`, **`duration_days` (computed once at
  creation and stored — a later change to holiday/week-off config must not
  retroactively change what an already-raised request draws)**,
  `financial_year`. **No `approver` field, no approve/reject action.**

### The overlay model, extended (not re-invented)

`attendance/day_facts.py::get_day_facts()` gained an `employee` parameter
(`None` by default — org-wide facts don't need one; `is_on_leave` does) and
now reads Leave's own approved requests to fill the placeholder that was
already there from Step 3. This is the one place `attendance` imports from
`leave` — a narrow, read-only fact lookup, not a shared model. `leave` does
not import from `attendance` in return for that; the reverse rule (below) is
its own one-directional check.

### Explicit conflict rules (`leave/conflicts.py`), resolving Step 3's two deferred items

- **Leave blocks WFH/Regularisation for the same date** — implemented on
  *both* sides: `attendance/conflicts.py` (rule 8, new) rejects a new WFH/
  Regularisation request that overlaps an *approved* Leave; `leave/conflicts.py`
  rejects a new Leave request that overlaps an active WFH/Regularisation
  request. Neither app imports the other's conflict rules, only the one
  narrow fact each needs.
- **Leave is allowed to span a holiday or a week-off** — not rejected, per
  direct instruction; those days simply don't count toward `duration_days`.
- A new Leave request cannot overlap the same employee's own existing
  submitted-or-approved Leave request, any type (symmetric to Attendance's own
  overlap rule).
- A half-day request must be for a single date (matches `leave/page.tsx`'s own
  forced `end_date = start_date` behaviour for a half-day pick).
- Sufficient balance is required at creation (`duration_days <= available`).
- **JUDGMENT CALL, flagged as one**: a request may not cross a calendar-year
  boundary, since `financial_year` is a plain year and a cross-year request
  would need to draw from two balance rows. MVP simplification, not dictated.

### Day-counting for balance deduction (`leave/duration.py`) — partially confirmed, partially this app's own extension

Confirmed directly: week-off days are excluded (the frontend's own client-side
estimate already excludes weekends; making that HR-configurable rather than
hardcoded was the correction above). **Extending the same exclusion to
holidays is this app's own consistent application of that reasoning, not a
separately confirmed rule** — flagged explicitly in `leave/duration.py`'s
docstring as the one part of this calculation that wasn't a direct
instruction, in case it needs to be revisited. A half-day request is always
exactly 0.5 days (matches `estimateDays`'s own flat `0.5` return).

### The day-view's `status` field, now resolved (was flagged as still-open in Step 3)

Precedence is **Holiday > Weekend/week-off > Leave > a clock-in-derived status
> absent/not_marked** — not arbitrary: Leave is explicitly allowed to span a
Holiday/week-off *and* those days don't count toward `duration_days`, so a day
that isn't being drawn from the balance shouldn't display as "On Leave"
either; Holiday/Weekend already outranked a voluntary clock-in before Leave
existed, and Leave (an approved, per-employee fact) sits in the same
relationship to a clock-in, one level down. Nothing is hidden: `check_in`/
`on_leave`/etc. are always populated from their own fields regardless of what
`status` says.

### CRUD / API endpoints (all built, matching `lib/api/leave.ts`)

`GET/POST /leave/types`, `PUT/DELETE /leave/types/{id}` (delete blocked with a
409 if a balance or request still references the type — same pattern as
`employees/views.py`'s reference-table deletes); `GET /leave/balance` (own,
lazily seeded); `GET/POST /leave/requests`, `POST /requests/{id}/cancel`,
`GET /requests/approvals/pending` (manager-scoped, read-only, mirrors
Attendance's); `GET /leave/holidays?year=` (reshapes `org_calendar`'s holiday
`CalendarEntry` rows into the separate `Holiday` type the pre-existing
`/calendar` page and Home's `HolidaysWidget` already expect — one source of
truth, not a second holiday list, per §11's resolution direction; `is_optional`
has no `CalendarEntry` equivalent and is always `False`, a stated contract gap
rather than an invented field).

### RBAC

`leave.read`/`leave.write` (no frontend-mandated name, follows `example_leave`'s
convention, same as Attendance). `leave.approve` — already a hardcoded
frontend nav-gate string; same treatment as `attendance.approve` (scopes the
read-only pending-approvals list, not consulted by the engine's decide
endpoints). **`attendance.settings.manage` is registered here** — Leave Types
needed it first among the three areas that share it (Leave Settings now;
Shifts/Policy Settings, Step 6, later); per the registry's one-owning-
registration rule, Step 6 references this code, it does not redeclare it.
`LeaveType` read is open to any authenticated employee (matches `/leave`'s own
lack of a `hasPermission` call) while write requires `attendance.settings.manage`
— done via `get_permissions()` relaxing the class-level `HasPermissionCode`
for `list`/`retrieve` only, so `core.checks` still verifies the write code.

### Approvals integration

`request_type="leave"`. **`requires_approval=True`** raises through
`approvals.create_request()` exactly like `example_leave`/Attendance;
`leave/handlers.py`'s `@receiver(request_decided)` sets `LeaveRequest.status`
and moves the balance's `pending` hold into `used` (approved) or releases it
(rejected/withdrawn). **`requires_approval=False` bypasses the engine
entirely** and auto-approves + deducts immediately in the same request —
confirmed with the project owner as the right mechanism, by direct analogy to
Penalisation's existing exemption (no human decision is being made, so there's
nothing for the engine to route; this is not "duplicate approval logic," since
no approval is happening). A request raised this way never gets an
`approval_request` and can't be cancelled through `/requests/{id}/cancel`
(that action requires `status == submitted`, which an auto-approved request
never is) — cancelling an already-approved leave is out of scope for this
pass, same limitation Attendance already accepted for its own regularisation
requests.

### Notifications / audit

Free from the engine for the `requires_approval=True` lifecycle. Direct writes
(request create, auto-approval, cancel, `LeaveType` CRUD) call `write_audit`
directly.

### Still open — not addressed by this step

**Half-day/attendance interaction** (§7 item 4 in the original open-decisions
list) is only half-resolved: this step handles half-day's effect on the
*balance* (always exactly 0.5 days), but `day_facts.DayFacts`'s leave overlay
is a plain boolean (`is_on_leave`) — it doesn't distinguish a half-day leave
from a full-day one, so a half-day-leave date displays identically to a
full-day one in Attendance's day-view (generic `on_leave`), and nothing models
whether a partial clock-in is expected that day. Still genuinely undefined,
not assumed here.

### Tests (46 tests, all passing; 7 more in `org_calendar` for `WeekOff`, 3 more in `attendance` for the Leave overlay/conflict wiring)

`test_rbac_wiring.py`; `test_leave_types.py` (mixed read-open/write-gated
permission, code auto-derivation + collision suffix, protected delete);
`test_leave_balance.py` (lazy creation, scoping, inactive-type exclusion);
`test_conflicts_and_duration.py` (duration math, every conflict rule in
isolation); `test_leave_requests.py` (both `requires_approval` paths, scoping,
cancel, balance sufficiency); `test_approvals_integration.py` (mirrors
`example_leave`'s: routes to manager, balance pending→used/released per
outcome, ignores other modules' decisions); `test_holidays.py`.

### Definition of done — met

Leave types/balances/requests match the frontend contract exactly;
`requires_approval=True` requests raise through the generic engine with no
bespoke approve endpoint, `requires_approval=False` ones bypass it entirely by
design; every conflict rule (including both deferred Step 3 items) is
enforced before a request is ever created; `manage.py check`, `ruff`, `black`,
and the full repo test suite (434 tests) pass.

---

## Step 5 — Approvals integration (cross-cutting checklist) (verified)

Steps 3 and 4 already specified the wiring per module; this step is the
consolidated verification pass once both exist, done for real (not just
asserted) in `approvals/tests/test_cross_module_integration.py` — the one
place that exercises Leave and Attendance together against the real HTTP
endpoints, since neither module's own test suite does that by itself.

- **`request_type` naming** — checked directly (`grep` across both modules'
  raise sites and receiver filters, cross-referenced against each other):
  `"leave"` (leave/views.py ↔ leave/handlers.py), `"wfh"` and
  `"attendance_regularization"` (attendance/views.py ↔ attendance/handlers.py).
  One real bug this exact check caught earlier, in Step 3: the receiver was
  filtering on the wrong strings and silently no-op'ing every regularisation
  decision — fixed then, re-confirmed clean now.
- **No module registers its own approve/reject endpoint** — checked directly:
  the only `def approve`/`reject`/`decide` outside `approvals/` itself is
  `example_leave/views.py`'s known, already-flagged vestigial one (1.4);
  neither `attendance/views.py` nor `leave/views.py` has one.
- **`GET /api/requests` is the real inbox for Leave/WFH/Regularisation** —
  verified live (through the real router, real permissions, real serializers,
  not the service layer directly): a Leave request raised via
  `POST /leave/requests` and a WFH request raised via `POST /attendance/requests`
  both appear in `GET /requests/` for the right manager and not for an
  unrelated one; deciding through `POST /requests/{id}/approve/` and
  `.../reject/` lands back on the correct `AttendanceRequest`/`LeaveRequest`
  row (including the WFH approval actually marking the `AttendanceRecord`
  `work_from_home`) — no frontend change needed, `lib/api/requests.ts` was
  already generic.
- **Penalisation is excluded** — checked directly: zero references to
  "penalis" anywhere in `attendance/` or `leave/` (it isn't built yet, Step 8;
  trivially satisfied for now, worth re-checking when Step 8 lands).
- **`approvals.manage`'s reassign/force-resolve escape hatch** — verified
  against a *real* consumer request, not a synthetic one: an employee with no
  manager raises a Leave request (lands unassigned); HR Admin force-resolves
  it via `POST /requests/{id}/resolve/` and the `LeaveRequest` row actually
  updates. Separately, HR Admin reassigns a stuck WFH request via
  `.../reassign/` to a different manager, who then successfully decides it.

### Definition of done — met

Leave, WFH, and Regularisation requests all appear in the generic `/approvals`
inbox, decide correctly through the generic endpoints, and land back on the
correct domain row via signal — end to end, for all three flows, with no
module short-circuiting the engine. 6 new tests, 440 total repo-wide, all
passing.

---

## Corrections found during manual verification (post-Step 5)

Five things surfaced only by actually clicking through the running app —
none of them were caught by the automated suite, because the suite talks to
Django directly and none of these bugs live in Django's own request/response
cycle. Recorded here since they changed already-"done" earlier steps.

1. **The Approvals nav item moved back under Attendance, with per-type tabs,
   per explicit instruction.** The RBAC merge (Step 1) had promoted Approvals
   to a top-level nav item with generic "To approve"/"My requests" tabs. The
   project owner rejected this — Approvals belongs nested under Attendance
   (`layout.tsx`'s Attendance children: Dashboard, My Attendance, Approvals,
   Settings), with **WFH / Regularisation / Leave / Penalisation** as its own
   in-page tabs, restoring the pre-RBAC design (recovered from git history at
   commit `b880b04`, the tip of this branch just before the merge). The
   decision *mechanism* still uses the generic engine exclusively (no bespoke
   approve endpoint was reintroduced) — each tab reads its pending list from
   the relevant module's own scoped `getPendingApprovals()` (real, already
   built), but decides through `requestsApi.approve/reject`, keyed by a new
   `approval_request_id` field added to both `AttendanceRequestSerializer` and
   `LeaveRequestSerializer` for exactly this purpose. The old design's
   per-tab "History" (decided requests) was initially **not** restored — see
   item 4 below, which restores it properly instead of reconstructing it from
   the generic engine's raw `payload`.
2. **`backend/approvals/api_urls.py` had the exact `trailing_slash` bug this
   plan already fixed three times over (org_calendar, attendance, leave) —
   found while testing the restored Approvals UI's actual approve/reject
   buttons, not by any automated test.** The frontend's generic requests proxy
   (`app/api/requests/[[...path]]/route.ts`) never appends a trailing slash to
   a sub-path, so `POST /requests/{id}/approve` hit Django's default
   `APPEND_SLASH` redirect, which can't preserve a POST body — every decide
   action in the entire app was silently broken, including the pre-existing
   generic inbox's own buttons, predating this branch's work entirely. Fixed
   with the same `trailing_slash=False` pattern, plus one explicit extra route
   for `requests/` (with the slash) since that one prefix's frontend route is
   the sole *optional* catch-all in the app (`requestsApi.list()` calls the
   bare prefix), and the shared proxy helper always supplies a trailing slash
   in exactly that zero-segment case. This is the one place this plan edited
   `backend/approvals/` despite §0's "build on it, don't edit it" — justified
   as a mechanical bug fix blocking basic functionality, not a design change,
   and using a pattern this plan had already applied three times elsewhere.
3. **N+1 queries in `attendance/day_facts.py`, found as reported UI lag.** The
   single-date `get_day_facts()` was being called once per day in a loop by
   every multi-day caller (`/attendance` history, `/attendance/summary`, both
   conflict-validation loops, `leave/duration.py`'s day-counting) — a 30-day
   history call issued 90+ queries. Fixed by adding `get_day_facts_range()`,
   which fetches each data source once for the whole range (fixed query count
   regardless of range length) and makes `get_day_facts()` a thin single-date
   wrapper over it; every multi-day caller now uses the range function
   directly. A regression test (`django_assert_max_num_queries`) locks this in.
4. **The generic decide endpoints (`approve`/`reject`) only work for a
   request's actual named approver — `leave.approve`/`attendance.approve` at
   ALL scope (HR Admin) grant *visibility* into every pending request, not
   decision authority over ones routed to someone else.** Found live: HR Admin
   saw a request routed to a manager and got "Only the assigned approver can
   decide this request" on Approve. This is the engine working as designed,
   not a bug — the fix was in the frontend: `approvals/page.tsx`'s decide
   handler now compares the viewer's id to the request's `approver_id`
   (threaded through as a new field on `PendingItem`) and calls
   `requestsApi.resolve()` (the already-built `approvals.manage` escape
   hatch) instead of `approve`/`reject` when they're not the same person —
   `requestsApi` gained `resolve`/`reassign` client methods for this. Verified
   live: HR Admin resolved a request routed to a different manager; the
   manager still shows correctly as who it was originally routed to.
5. **Per-tab History (decided requests) — restored properly, not left as the
   flagged gap in item 1.** Added `approvals_history` (mirrors
   `approvals_pending`: same scope resolution, opposite status filter —
   `exclude(status=SUBMITTED)` instead of `filter(status=SUBMITTED)`) to both
   `AttendanceRequestViewSet` and `LeaveRequestViewSet`, at the exact URLs
   `getApprovalHistory()` already called (`/attendance/requests/approvals/
   history`, `/leave/approvals/history` — the latter needed the same explicit
   extra route as `/leave/approvals/pending` did, for the same reason).
   `approvals/page.tsx`'s `ApprovalSection` now restores the original
   Pending/History toggle per tab, using each module's own rich serializer
   data (employee name, leave type, rejection reason, approver, ...) — never
   needed to touch the generic engine's raw `payload` for this after all.

---

## Step 6 — Shifts and policy settings backend (built)

Built inside the existing `attendance` app (`settings_views.py`/
`settings_serializers.py`, kept separate from the self-service check-in/request
files), not a new app — Shifts is directly attendance-domain (late/early/
overtime will compute against an assigned Shift once that wiring lands), and a
third one-model app for this would've been unnecessary given `attendance`
already exists.

### Models (`attendance/models.py`)

- `Shift`: name (unique), start time, end time, break minutes, `employees`
  (a plain M2M, not a FK from `Employee` — nothing in the frontend enforces
  "one shift per employee" either, and a FK the other way would mean editing
  `employees.Employee`, off limits per §0; the M2M's through-table lives
  entirely in `attendance`'s own migrations).
- `PolicySettings`: a genuine singleton — `PolicySettings.load()` does
  `get_or_create(pk=1)` and `save()` forces `pk=1`, so there is exactly one
  row, always. Flat fields (`no_attendance_enabled`,
  `no_attendance_leave_days_deducted`, ...); nested in the API response (below).

### CRUD / API endpoints

`Shift`: full CRUD at `/attendance/shifts` (`HasPermissionCode`, flat, not
employee-keyed data — same reasoning as `org_calendar`, Step 2/1.4).
`employee_ids` fully replaces the assignment on every write, matching
`ShiftsSettingsPanel.tsx`'s own behaviour (its assignment modal always returns
the complete selected list, never a delta).

`PolicySettings`: **not** a router-registered resource — there's exactly one
row, so `/attendance/policy-settings` is a plain `APIView` (GET reads the
singleton, PUT replaces it wholesale, matching `PenalizationSettingsPanel.tsx`'s
own save flow, which always sends the complete settings object). The nested
shape (`noAttendance: {enabled, leaveDaysDeducted}`) doesn't map onto the flat
model via ordinary `ModelSerializer` field mapping, so `PolicySettingsSerializer`
is a plain `Serializer` with hand-written `to_representation`/`update` —
routed through the declared nested sub-serializers' own `to_representation`
(not a hand-built dict of raw model values), since a raw `Decimal` slipping
through isn't just a display bug: it's a hard crash the moment it reaches the
audit-log `JSONField` write (found by the test suite, not by inspection).

**A genuinely different rendering choice from Steps 2–5, and why**: `Shift`/
`PolicySettings` have no existing API client (`lib/attendance/shifts.ts` and
`penalisation.ts` are still local component state, unlike calendar/attendance/
leave, which all had to preserve an *existing* snake_case wire contract a real
client already called). So these use the project's **default** CamelCase
renderer/parser, not the snake_case-preserving `EnvelopeMixin` those three
modules needed — normal Django snake_case fields already come out as
`startTime`, `employeeIds`, `noAttendance`, etc. for free, matching the
frontend's existing TS field names exactly with no translation layer to build
in Step 11.

### RBAC

`attendance.settings.manage` — **referenced here, not re-registered**. Leave
(Step 4) already owns the registration (it needed the code first, among the
three areas that share it); per the registry's one-owning-registration rule,
this module's views set `required_permission = "attendance.settings.manage"`
as a plain string and nothing else.

### Approvals integration

None — Shifts and Policy Settings are admin configuration, not a request/decision flow.

### Notifications / audit

`write_audit` on every Shift create/update/destroy and every Policy Settings
update, same pattern as `org_calendar`. No notifications.

### Tests (14 new tests, all passing)

`test_shifts.py` (permissions incl. 401/403, camelCase field round-trip, an
overnight shift stored as-is with no special wrap-around handling, whole-list
assignment replacement, list/delete + audit); `test_policy_settings.py`
(permissions, lazy singleton creation with defaults, full-object PUT replacing
the one row, rejecting an incomplete nested payload).

### Definition of done — met

Shifts CRUD + assignment and Policy Settings match their frontend contracts
exactly (camelCase field names verified live, not just asserted); 
`attendance.settings.manage` gates all of it via the single registration Leave
already owns; verified live against the real endpoints directly (no frontend
proxy/client exists for these yet — that's Step 11, when
`ShiftsSettingsPanel.tsx`/`PenalizationSettingsPanel.tsx` stop being local
state); 463 tests pass repo-wide, `manage.py check`/`ruff`/`black` clean.

---

## Comprehensive audit (post-Step 6)

A deliberate pass over everything built so far (Steps 1–6), specifically
hunting for the same *classes* of bug already found by accident during manual
verification (id serialization, unguarded input parsing) rather than waiting
for the next one to surface that way. Six real, confirmed bugs found and
fixed, all with regression tests — none were caught by the 463 tests already
passing, because none of those tests asserted the specific thing that was wrong.

1. **`org_calendar`'s three serializers (`CalendarEntry`/`RecurringWfhRule`/
   `WeekOff`) returned a bare integer `id`**, though `lib/api/calendar.ts`
   types it as `string` — the same class of bug already fixed in attendance/
   leave/Shift's serializers, just missed here since `org_calendar` (Step 2)
   was built first, before that pattern was established. `LeaveType.id` had
   the identical gap despite every *other* id in that same file already being
   fixed. A first attempt at fixing `org_calendar` with a shared
   `_StringIdMixin` **silently did not work** — DRF's `SerializerMetaclass`
   only collects declared fields from base classes that themselves went
   through that metaclass (have their own `_declared_fields`); a plain mixin
   class doesn't, so `id` fell straight back to the auto-generated
   `IntegerField` with no error anywhere. Caught only by checking the actual
   live response after the "fix," not by reading the code or running the
   existing tests. Fixed by declaring `id`/`get_id` directly on each
   serializer instead (matching every other serializer in this codebase);
   verified this time with `cls().get_fields()['id']` before trusting it.
   `AttendanceRecordSerializer.marked_by` had the same latent gap (currently
   always `null` — nothing sets it yet — so not a live bug, but fixed
   pre-emptively since it was a two-line change).
2. **A non-numeric `year` on `GET /leave/holidays` crashed with an unhandled
   500** (`int(year_param)` with no guard). Fixed with a try/except raising a
   clean `ValidationError`.
3. **A non-numeric `leave_type_id` on `POST /leave/requests` crashed with an
   unhandled 500** — a raw `pk=` filter reached Postgres before Django
   validated the type, and `DataError` isn't one of `core.exceptions`'s
   recognized exception types. Fixed the same way as #2.
4. **A non-numeric id embedded in a *decided* request's payload crashed the
   approver's decide call**, in both `attendance/handlers.py` and
   `leave/handlers.py`. The generic engine's `payload` is free-form JSON —
   anything reachable through the "Raise a request" form on `/approvals` can
   put an arbitrary string in `attendance_request_id`/`leave_request_id`, and
   the manager who later approves or rejects it would 500, not the person who
   raised it. Fixed by guarding the `int()` cast and treating a malformed id
   the same as a not-found one (silent no-op, matching the existing "row is
   None" branch).
5. **A non-numeric `approver` on `POST /requests/{id}/reassign` (the
   `approvals.manage` escape hatch) crashed with an unhandled 500** — same
   root cause as #3, in `backend/approvals/views.py`. This is the second
   place this plan edited `approvals/` despite §0's "build on it, don't edit
   it" (the first was the `trailing_slash` fix, Step 5's corrections) —
   justified the same way: a narrow, mechanical crash fix, not a design
   change, using a pattern already applied four times elsewhere in this pass.

None of the six needed a design change — every fix is a guard clause or a
field declaration. All are covered by a new regression test in the relevant
app's test suite. 468 tests pass repo-wide (463 + 5 new: the four crash
guards plus the org_calendar/LeaveType id-type lock-in, several of which
cover more than one of the six bugs), `manage.py check`/`ruff`/`black` clean,
`tsc --noEmit` clean, and all six were re-verified live against the running
dev server (not just via pytest) before being marked fixed.

---

## Step 7 — Leave balances & accruals (built)

Builds on `LeaveBalance` (Step 4's model). Opening-balance seeding and
carry-forward were built first; Comp Off accrual followed once its two open
decisions were resolved by direct instruction (below), closing out the last
unbuilt piece of this whole plan.

### The shared scheduled-job mechanism — resolved

No task queue, Celery, or cron mechanism existed anywhere in this repo
(confirmed clean in `docker-compose.yml`/`requirements.txt`). Introducing one
for what is, today, a once-a-year job would be a disproportionate new
dependency. **Resolved as: a plain Django management command
(`leave/management/commands/roll_leave_balances.py`), invoked by an external
scheduler** (OS cron / Windows Task Scheduler) — the same pattern this repo
already uses for `verify_rbac`, `seed_demo_org`, etc. This is now the shared
mechanism Steps 3 (attendance-day finalization) and 8 (Penalisation auto-apply)
should reuse rather than each inventing their own.

### Opening balance + carry-forward (`leave/balances.py`) — built

`get_or_seed_balance(employee, leave_type, financial_year, *, actor=None)` is
the one place a `LeaveBalance` row is ever created — both the self-service
read (`LeaveBalanceViewSet.list()`) and `roll_leave_balances` call it, so
whichever runs first for a given employee/type/year does the real seeding and
the other just finds the row already there (idempotent by construction, not
by a separate lock/check).

- `allocated` seeds from the leave type's current `annual_allocation`.
- `carry_forward` is the previous year's unused balance (`available`, floored
  at 0), capped at the type's `carry_forward_limit`; 0 if no previous-year row
  exists (a new employee/type has nothing to carry forward — **proration for a
  mid-year joiner is still explicitly out of scope**, same as Step 4 left it).
- The portion that exceeded the cap is written back onto the *previous* year's
  row as `lapsed` — computed once, at the new year's first seed, and never
  revisited afterward (matches `LeaveRequest.duration_days`'s "computed once
  at creation, stored" precedent: a later policy change must not retroactively
  rewrite an already-closed year). This is what finally gives the `lapsed`
  field (present on the model since Step 4, never set by anything) real data.
- Every seed and every `lapsed` write calls `write_audit` (`actor=None` from
  the scheduled command, matching `provision_logins`'s convention for a
  system-triggered action; the requesting user from the self-service path).

### Comp Off accrual — built, post-Step-12 (open decisions resolved by direct instruction)

The two open decisions carried forward across every prior revision of this
plan — *when* accrual is evaluated and *how* a credit is applied — were put
directly to the project owner rather than guessed at, and resolved as:

- **Cadence: evaluated at check-out, against a running per-employee tally —
  not a periodic sweep.** `overtime_minutes` is already computed the instant
  an employee checks out (`timing.py`, wired into `views.py`'s `check_out` in
  the post-Step-6 bug audit); there is no reason to wait for a separate
  scheduled job to notice a number that already exists. A new model,
  `CompOffAccrualState` (one row per employee, `uncredited_overtime_minutes`),
  holds the running total of overtime not yet converted into a Comp Off.
- **Application: credited as a real `LeaveBalance.allocated` bump against a
  new, symmetric `PolicySettings.comp_off_leave_type`** — the same "one
  configurable leave type, shared across the org, nullable until HR sets one"
  shape `penalty_leave_type` already established for the opposite (penalty)
  direction (Step 8, post-hoc). Nullable: a fresh install has no leave type
  configured yet, so the tally still runs (nothing is lost) but nothing is
  ever credited until HR sets one — mirrors `_deduct_leave`'s own "still
  record the fact, consume/credit nothing" framing exactly.

`attendance/comp_off.py`'s `accrue_comp_off(employee, overtime_minutes,
policy=None)` is the one place this happens: adds the new overtime minutes to
the tally, credits `tally // threshold_minutes` Comp Offs (plural in one call
if overtime is large enough to cross the threshold more than once), leaves any
remainder banked rather than discarding it, and — only if at least one credit
happened — bumps `LeaveBalance.allocated` (seeded via the same
`get_or_seed_balance` Step 7's own opening-balance work already built),
writes an audit entry, and notifies the employee. Locked the same way every
other `LeaveBalance` mutation in this app is (PLAN.md Step 12): `get_or_create`
then a `select_for_update()` re-fetch inside one `transaction.atomic()` block
covering both the tally and the balance write.

### CRUD / API endpoints

`GET /leave/balance` (Step 4) now seeds through `get_or_seed_balance` instead
of its own inline `get_or_create`. `roll_leave_balances --year YYYY` (defaults
to the current year) is the admin/ops entry point for the yearly rollover — no
HTTP endpoint for it; the same `attendance.settings.manage`-gated admin-edit
endpoint Step 4 already exposes on `LeaveBalance` covers manual correction.
Comp Off accrual has no endpoint of its own either — it's triggered entirely
from within `POST /attendance/check-out` (Step 3); `comp_off_leave_type_id`
rides on the existing `PolicySettings` resource (Step 6), sibling to
`penalty_leave_type_id`.

### RBAC

No new permission code — `attendance.settings.manage` (Step 4/6) already gates
`LeaveBalance` admin editing and `PolicySettings` writes (so only HR can set
`comp_off_leave_type`); the rollover command is an ops action outside the API
entirely, same trust boundary as any other management command; accrual itself
runs inside the self-service check-out endpoint any employee can already call
on their own record.

### Approvals integration

None — carry-forward and Comp Off accrual are both computed, not
requested/approved, same as Penalisation (Step 1.3 already rules this whole
class of automatic ledger adjustment out of the generic engine's scope).

### Tests (17 new tests, all passing: 9 balances-rollover + 8 Comp Off accrual/check-out)

`test_balances_rollover.py` (pre-existing, see above). New for Comp Off:
`test_comp_off.py` — credits exactly one Comp Off when the tally crosses the
threshold exactly; partial overtime is banked, not credited; a remainder
carries forward across separate calls until it crosses the threshold; a
single large overtime value credits multiple Comp Offs in one call and keeps
the correct remainder; disabled/unconfigured (`comp_off_accrual_enabled`
False, or no `comp_off_leave_type`) credits nothing and doesn't even create a
tally row; `None` overtime (no shift assigned) is a no-op; accruing onto a
balance another mechanism already touched adds to it rather than overwriting
it. `test_check_in_out.py` — two new tests wiring `check_out` end-to-end to a
configured Comp Off leave type (credits it) and to an unconfigured one
(doesn't even create a tally row). `test_policy_settings.py` — three new
tests for `comp_off_leave_type_id`'s get/put/validation, symmetric with
`penalty_leave_type_id`'s own existing three.

### Definition of done — met

Opening balances and carry-forward compute correctly across a year boundary,
verified live earlier (`roll_leave_balances --year 2027` against the real dev
database). Comp Off accrual is now built and verified live too: a real
check-in/check-out cycle against a shifted employee with ~2h of overtime and a
2h-per-Comp-Off policy, run directly against the live dev database (not just
the test suite), credited exactly 1 Comp Off to the configured leave type's
`LeaveBalance.allocated` and reset the running tally to 0; the
`PolicySettings` GET/PUT round-trip for `comp_off_leave_type_id` was verified
live the same way. The full repo-wide suite passes (554 tests,
`manage.py check` clean, frontend `tsc --noEmit` clean) — no remaining open
items anywhere in this plan.

---

## Step 8 — Penalisation (built)

**Not built on the approvals engine** (1.3) — this is the one area where the
prior domain-specific design is preserved deliberately, not superseded by the
engine.

### Models

`PenalisationRecord`: `employee` FK, absence date, deadline, reason, `status`
(`applied` | `overturned`), overturned-by/reason — matches `PenalisationRecord`
in `lib/attendance/penalisation.ts` exactly. **No overturn-request fields** —
corrected post-Step-7 (see §1.3): an employee cannot request an overturn, so
there is no `overturn_requested` state and nothing for it to carry (no request
reason/date). Policy configuration itself (regularisation grace period,
absconding threshold, per-rule flags, Comp Off rate) is `PolicySettings`,
already covered in Step 6.

### Services / business logic

- Auto-apply is triggered by the same shared scheduled mechanism as Step 7 (once
  a regularisation grace period lapses with no attendance) — no approval step for
  the initial `applied` state, matching the frontend's "automatically" language.
- Overturning is a **direct HR action on an Applied record** (`applied` →
  `overturned`, with a required reason) — not a state machine with an
  intermediate requested state, and not a raise-then-route-to-manager flow:
  there's no "requester's manager" concept here, and per the corrected design
  (§1.3) the employee has no initiating role at all. Whoever holds the manage
  permission below can overturn any record in their scope.
- **Leave-day deduction — resolved, no longer open.** A Penalisation now
  really does deduct a real `LeaveBalance` (Step 4/7), against
  `PolicySettings.penalty_leave_type` — one shared leave type for every
  enabled rule, a new setting, not one per rule (direct instruction). Deducted
  once at creation (`attendance/penalisation.py`'s `_deduct_leave()`, "compute
  once, store" — same precedent as `days_overdue`), recorded on the
  `PenalisationRecord` itself (`leave_days_deducted`, `leave_balance` FK to
  the *exact* balance row debited) so overturning credits back to that same
  row even across a financial-year rollover, rather than re-resolving "the
  employee's current balance" at overturn time. Only wired for **No
  Attendance** — the only rule with real auto-apply detection behind it
  (below); Late Arrival/Early Leaving/Work Hours still have no detection at
  all, so their `leaveDaysDeducted` numbers stay descriptive-only, unchanged
  from before. If the rule is disabled or no leave type is configured, the
  Penalisation record still gets created (it's still a factual record of the
  absence) with `leave_days_deducted=0` and no balance touched.
- **Open decision, carried forward — absconding behaviour**: an "absconding
  threshold" (consecutive absent days) exists in Policy Settings, but nothing in
  the frontend shows what happens once it's crossed — no UI reads or reacts to an
  "absconded" state. Whether this should affect `Employee.status` (currently
  `active`/`on_leave`/`exited`, defined in `core/enums.py`, outside this module)
  is undefined, and any change to that shared enum is a deliberate, separately-
  agreed core change (§0), not something this module decides unilaterally.

### CRUD / API endpoints

Match `lib/attendance/penalisation.ts`'s shape: a scoped list for HR
(Approvals → Penalisation, Applied/Overturned filters), a self-service
read-only list for the employee (Leave Management — their own records only,
no write action available to them at all), and one overturn action (HR only,
on an Applied record).

### RBAC

The Approvals → Penalisation tab **currently has no permission gate at all**
(1.6) — a real permission code is required here regardless of frontend
precedent, since real scoped data needs real enforcement (`core.E001`–`E004`
demand it the moment a real view exists). This is new — there is no existing
hardcoded frontend string to match, unlike `leave.approve`/`attendance.approve`.
Given the corrected design has no review/decide split (§1.3) — just one HR
action, "overturn" — this follows the same flat `<module>.manage` naming
`attendance.settings.manage` already uses for an admin-only action, not a
`.review`/`.approve` verb that would imply deciding someone else's request:
**`penalisation.manage`**, `HasPermissionCode`, `default_grants={"HR Admin":
ScopeTier.ALL}` (matches how the user described it: "the admin can overturn it
if he wants" — not a manager-scoped action).

### Approvals integration

Explicitly none, per 1.3 — do not route Penalisation through
`approvals.create_request()`.

### Notifications / audit

Auto-apply and every overturn call `write_audit`; notify the employee on
auto-apply and on overturn (via `notifications.service.notify` directly, the
same primitive the approvals engine itself uses internally — no need to invent
a different notification mechanism).

### Frontend wiring (pulled forward, same as Step 7's Leave Balances admin view)

`lib/api/penalisation.ts` (new) replaces the old localStorage-backed
`usePenalisations()`/`SAMPLE_PENALISATIONS` (removed from
`lib/attendance/penalisation.ts`, which now holds only the real Policy
Settings helpers it always also had). Approvals → Penalisation (HR),
Leave Management's own read-only Penalisations section, and the Dashboard's
"Active Penalisations" tile all read the real endpoints now. The Approvals
page's Penalisation tab is gated on `hasPermission('penalisation.manage')`
like every other tab, closing 1.6's gap for real on the frontend too — a
manager without that permission no longer sees the tab at all (previously
unconditional). The Dashboard's tile, which a manager without
`penalisation.manage` *can* still reach (it's not scoped like the approval
tabs), degrades to `0` rather than surfacing a 403 — there is no manager/team
scope for Penalisation to fall back to (§1.3's flat, HR-only design), so `0`
is the honest answer for "how many I can see," not a bug.

### Tests (35 new tests total, all passing)

`test_penalisation.py` (16): every exemption rule (weekend, holiday, on-leave,
clocked-in, a submitted-and-not-cancelled regularisation request) in
isolation; a cancelled regularisation request does *not* exempt the day;
respects a custom grace period; idempotent across repeated runs (both the
function directly and the management command); every active employee is
covered, exited ones are skipped; audit log + notification on auto-apply;
leave-deduction: deducts the configured rate against the configured leave
type, skips the deduction (record still created) when the rule is disabled or
no leave type is configured, deducts exactly the configured amount (not a
hardcoded default). `test_penalisation_views.py` (16): 401/403 for the HR
list/overturn actions; HR sees every employee's records with the right
camelCase shape; the `?status=` filter; overturn updates
status/audit/notification correctly, credits the exact deducted amount back
to the exact balance row debited, leaves other balances untouched when
nothing was deducted, rejects a missing reason and an already-overturned
record, 404s on an unknown id; the self-service `mine` endpoint 401s
anonymously, 403s with no employee record, returns only the caller's own
records, and has no write action at all. `test_policy_settings.py` gained 3
covering `penalty_leave_type_id`: sets it, rejects an unknown id, rejects a
PUT that omits it (this serializer's "always the complete object" contract,
same as every other field).

### Definition of done — met

Auto-apply runs on schedule (`apply_penalisations`, idempotent) and matches
Policy Settings' grace-period rule; the direct overturn action works end to
end with a real, HR-only permission gate (closing the "visible to anyone who
can see Approvals" gap noted in 1.6, on both the backend and the frontend nav
gate); the employee's own Leave Management view is confirmed read-only (no
overturn action reachable from there — verified both in the component tree
and via a dedicated backend test asserting `MyPenalisationsView` has no write
action); a Penalisation now really deducts and restores real leave, verified
live end to end through the actual Next.js proxy (set `penaltyLeaveTypeId` →
ran auto-apply against the real dev database → confirmed the balance actually
moved → overturned it → confirmed the exact amount came back); 532 tests pass
repo-wide, `manage.py check`/`ruff`/`black` clean, `tsc --noEmit` clean.

---

## Step 9 — Dashboard / derived data where actually needed (built)

No dedicated storage for the Dashboard itself — real numbers now, computed
client-side over real scoped data instead of a fake roster.

### The read shape — resolved

**A dedicated multi-employee endpoint**, not a query parameter bolted onto the
self-only endpoints: `GET /attendance/team/daily?from=&to=` (or `?month=`),
one row per (employee in the caller's scope, date in the window). Scope is
resolved server-side via `core.scope.resolve_employee_scope` — the exact
function this step said not to reinvent — unioning `attendance.approve` and
`leave.approve` (whichever the caller holds; either already makes the
Dashboard tab nav-reachable, so no new permission code was invented for "can
see the dashboard"). Each row reuses `day_view.build_day_view()` directly —
the *same* function the self-service day-view already returns — extended with
only `employee_id`/`employee_name`/`department`, so a team member's day here
is computed identically to how they'd see it themselves, not a second,
parallel notion of "what does a day look like." Plain snake_case JSON
(`AttendanceDayView`'s existing shape), not the camelCase Shift/Penalisation
pattern, since this is built on an *existing* contract, not a fresh one.

`resolve_management_scope`'s `{kind, employeeIds}` (already built, pre-dating
this plan, wired into `GET /users/me` and `useAuth().hasOrgScope()`) turned
out not to be quite the right primitive to reuse directly — it resolves
`employees.read`'s tier, a directory-visibility concept, not
`attendance.approve`/`leave.approve`'s (who can act on whose attendance),
which could in principle differ for a custom role. `hasOrgScope()` is still
used as-is for the Dashboard's own "Organisation Overview" vs. "Team Overview"
heading text, since that's a directory-visibility question, not an
attendance-data one.

### Frontend

`lib/api/teamAttendance.ts` (new client) → `lib/attendance/dashboard.ts`
(rewritten: `statusFor`/`aggregateForDay`/`metricsForPeriod`/
`avgHoursForPeriod` now aggregate real `TeamAttendanceDayView[]` rows instead
of a seeded-random generator; the pure date-utilities `toLocalISODate`/
`lastNDays`/`periodDays` are unchanged, they never depended on the fake
roster) → `AttendanceDashboard.tsx`/`AttendanceLeaderboard.tsx` (now fetch
real data; the Leaderboard fetches its own range independently, since its
period selector can span up to a full month, wider than the Dashboard's own
fixed 7-day fetch). **Two new display buckets the old fake data never
needed**, both judgment calls flagged in `dashboard.ts` itself: `day_off`
(a holiday/weekend — excluded from the "did the workforce show up"
percentages, not counted as absence) and `not_marked` (today, not yet checked
in — a past day with no record already resolves to `absent` server-side, so
this can only ever mean "the day isn't over yet"). `lib/attendance/
sample-employees.ts` and the already-dead `lib/attendance/shifts.ts` (no
imports anywhere — a leftover from before Step 6/11's real Shifts wiring)
are both deleted.

### Tests (8 new, all passing)

`test_team_views.py`: 401/403 (including a caller with neither
`attendance.approve` nor `leave.approve`); a Manager sees themselves and their
direct reports only, never a stranger; an HR Admin sees every active employee
and no exited one; one row per employee per day across the window; the
response carries department and the full day-view field set; `?month=`
accepted; a missing window is a 400 (matching the self-service endpoint's own
behaviour, reused via the same `_resolve_window` helper).

### Definition of done — met

Dashboard and Leaderboard read real, correctly-scoped data instead of the
sample roster; verified live against the real dev server through the actual
Next.js proxy (`/attendance/team/daily` returning real per-employee day-view
rows for an HR Admin's org-wide scope); `lib/attendance/sample-employees.ts`
is deleted, not just "removable"; 540 tests pass repo-wide, `manage.py
check`/`ruff`/`black` clean, `tsc --noEmit` clean.

---

## Step 10 — RBAC and scope verification (largely resolved as a byproduct of Steps 3/4/6/8-9)

Consolidates every permission decision touched above into one pass. Written as
a forward-looking checklist before Steps 3–9 existed; re-verified against the
actual registered permissions now that they do, rather than left describing
codes that no longer match what got built.

### 10.1 Permission set, by source of obligation — verified against `core/registry.py`'s actual state

**Already hardcoded in the frontend (1.6), registered exactly as described:**
`leave.approve`, `attendance.approve` (nav-gates only, Steps 3–4 — not consumed
by the approvals engine's own decision logic), `calendar.manage` (Step 2),
`attendance.settings.manage` (Step 6, single owning registration in `leave`).

**Required by RBAC enforcement, not named by the frontend — registered (Steps
3–4):** `attendance.read`/`attendance.write` (`attendance/rbac.py`),
`leave.read`/`leave.write` (`leave/rbac.py`) — the `example_leave` `<module>.
<action>` convention, as planned.

**Resolved, not the shape originally guessed (Step 8, corrected post-Step-7 —
see §1.3):** `penalisation.manage`, not an "overturn-review" code — the
corrected design has no review/decide split to name a `.review` verb for, just
one HR action. Flat (`HasPermissionCode`, not scope-tiered), `default_grants=
{"HR Admin": ScopeTier.ALL}` only — deliberately **not** present at the
Manager tier at all (10.2 below), matching the direct instruction that
overturning is an admin action, not a manager one.

**Already registered, no action needed:** `approvals.manage` (HR Admin +
Finance, `ScopeTier.ALL` — the reassign/force-resolve escape hatch, Step 5).

### 10.2 Tier mapping (explicit task requirement, restated) — corrected

| Tier | Sections | Minimum permissions |
|---|---|---|
| Basic Employee | My Attendance only | Self-scoped `attendance.read`/`write`, `leave.read`/`write` (`ScopeTier.SELF`) — no `*.approve`, no `penalisation.manage`, no `calendar.manage`/`attendance.settings.manage` |
| Admin / Team Manager | Dashboard (their scope), My Attendance, Approvals (their scope) | Everything above, plus `leave.approve`/`attendance.approve` at `ScopeTier.MANAGER` (nav + Step 9's Dashboard scope) — **no `penalisation.manage`**, corrected from this section's original guess: overturning is HR-only, a manager viewing the Dashboard sees `0` Active Penalisations, not a scoped count (Step 8/9) |
| HR Manager | Everything, incl. Settings | Everything above at `ScopeTier.ALL`, plus `calendar.manage`, `attendance.settings.manage`, and `penalisation.manage` |

Maps onto the already-seeded `Employee`/`Manager`/`HR Admin` roles, no new roles required.

- **Manager vs. team scope — resolved in practice, not left open.** Every
  scoped permission actually registered (`attendance.approve`, `leave.approve`)
  uses `ScopeTier.MANAGER` (direct reports only), consistently, across Steps
  3, 4, and 9 (Step 8's `penalisation.manage` doesn't have this question at
  all — it's flat `ALL`, not manager-scoped, by direct instruction). Nothing
  ever registered `ScopeTier.TEAM` for any of these codes. The
  manager-of-managers case this flagged remains genuinely unexercised (no
  multi-level reporting UI still), but the *codebase's* answer is settled:
  MANAGER, not TEAM, is this app's convention.

### 10.3 Registry hygiene — verified clean

`manage.py check` (which runs `core.checks`, including the cross-app
registration-conflict check) passes repo-wide, including with
`attendance.settings.manage` registered once (`leave/rbac.py`) and referenced,
not redeclared, from `attendance/settings_views.py` — the exact scenario this
subsection was watching for.

### 10.4 Cleanup, optional, no functional dependency

The vestigial `'scope.all'` string (1.6) — `hasOrgScope()` already covers what it
was meant for in the same `||` condition it appears in. Still not removed;
still optional, still no functional dependency on it.

### Definition of done — met

Every permission code above exists, is registered exactly once (`manage.py
check` verifies this on every run, not just at Step 10), and the tier table
holds against the actual registered `default_grants` — re-verified directly
against `core/registry.py`'s state rather than asserted. Three-real-accounts
testing (Employee/Manager/HR Admin) has been the standing verification method
throughout Steps 6–9's live checks already, not deferred to a separate pass.

---

## Step 11 — API / proxy integration (built)

**Shifts and Policy Settings pieces done already, pulled forward** — the user
hit the still-mock Shifts UI right after Step 6 shipped and asked "shouldn't
this work now?", so this part of Step 11 happened immediately rather than
waiting: no new proxy route was even needed (`attendance/[...path]/route.ts`'s
existing catch-all already forwards `/api/attendance/shifts` and
`/api/attendance/policy-settings` — both are just sub-paths of the already-proxied
`attendance` prefix), except adding `DELETE` to that route's exported methods
(nothing under this prefix had ever needed it before Shifts). Built:
`lib/api/shifts.ts` (real CRUD client, replacing `SAMPLE_SHIFTS`),
`lib/api/employees.ts` (a small real-directory read client — `/api/employees`
+ `/api/departments`, both already real — for the assignment picker, which now
groups by actual department instead of the sample roster's fake "team"),
`lib/api/policySettings.ts` (maps the backend's nested/string-decimal wire
shape to the exact existing `PenalizationSettings` TS type), and
`usePenalizationSettings()` rewired to that client instead of localStorage —
kept the same `[settings, updateSettings]` shape so both existing consumers
(`AttendancePolicyModal`, read-only; `PenalizationSettingsPanel`, the only
writer) needed only `updateSettings` becoming `async`, exactly per the plan
below. One real regression caught before it shipped: `PenalizationSettingsPanel`
initialized its edit draft from `saved` via `useState(saved)`, which only reads
that value once — safe when `saved` loaded synchronously from localStorage,
broken once it loads asynchronously from the network (the draft would always
start at hardcoded defaults). Fixed with a one-time sync effect.

**Penalisation (Step 8) and Dashboard (Step 9) — also done, same "pull forward
when its own step lands" pattern, not left for a separate Step 11 pass:**

- Penalisation: `lib/api/penalisation.ts` (new client, `getMine`/`getAll`/
  `overturn`) replaced `lib/attendance/penalisation.ts`'s old
  `PenalisationRecord`/`usePenalisations`/`SAMPLE_PENALISATIONS`
  (`localStorage`-backed) entirely — that file now holds only the real Policy
  Settings helpers it always also had. No new proxy route needed after all:
  `/attendance/penalisations*` is a sub-path of the already-proxied
  `attendance` prefix, same as Shifts/Policy Settings turned out to be.
  `approvals/page.tsx`'s Penalisation tab is now gated on
  `hasPermission('penalisation.manage')`, closing 1.6/10.1's "currently
  ungated" gap for real.
- Dashboard: `lib/api/teamAttendance.ts` (new client) feeds the rewritten
  `lib/attendance/dashboard.ts`, `AttendanceDashboard.tsx`, and
  `AttendanceLeaderboard.tsx` — no sample-roster generation left anywhere.
  `lib/attendance/sample-employees.ts` is deleted (Step 9), along with
  `lib/attendance/shifts.ts` (found fully dead — no imports anywhere, a
  leftover from before this same pulled-forward Shifts wiring).
- **No change needed** to `leave/page.tsx`, `me/attendance/page.tsx`,
  `CalendarManagementPanel.tsx`, `approvals/page.tsx`'s existing To-approve/My-requests
  tabs, or `lib/api/requests.ts` — they already called real clients against
  existing proxy routes throughout.
- Still optional, still no functional dependency: the `'scope.all'` cleanup (10.4).

### Definition of done — met

Every prefix (`leave`, `attendance` — including its `shifts`/`policy-settings`/
`penalisations`/`team` sub-paths, `calendar`, `requests`) runs with `MOCK_AUTH`
off against the real backend with no frontend behaviour change from the user's
point of view. Nothing in the frontend reads from `localStorage` or a sample
in-memory roster for domain data anymore — the only remaining non-real reads
listed in 1.5's inventory at the time were Comp Off accrual application
(Step 7, an open business-rule decision at the time — since resolved and built,
see Step 7's own section) and Late Arrival/Early Leaving/Work Hours
auto-detection (Step 8, scoped out by direct instruction — their settings are
real and persisted, but nothing evaluates them yet).

---

## Step 12 — Testing and verification (done)

- **Conformance kit — deliberately not force-applied, finding recorded rather
  than worked around.** `assert_module_conforms()` assumes a REST-conventional
  list+detail+create shape with a genuinely scope-tiered list (verified against
  `payroll/conformance.py`, the one other module that uses it with no bespoke
  actions). Neither `AttendanceRequestViewSet` nor `LeaveRequestViewSet` match
  that shape: their main `list()` is deliberately self-only "by frontend
  design" (1.5) at every tier — Manager/HR Admin's broader `attendance.read`/
  `leave.read` grants are real but unused by this specific view, exactly like
  `AttendanceViewSet`'s self-service history — and neither exposes a `retrieve()`
  at all (no `RetrieveModelMixin`), which the kit's "in-scope detail opens"
  check requires. Force-fitting it would mean either asserting scope-tiering
  that doesn't exist, or adding a `retrieve()` endpoint the frontend never
  asked for, purely to satisfy a test tool (§0's over-engineering guardrail).
  The views that *do* genuinely scope-tier a list (`approvals_pending`/
  `approvals_history` in both apps, `/attendance/team/daily`, Step 9) already
  have their own direct, hand-written scope tests instead — Shifts/Policy
  Settings/Penalisation followed `org_calendar/tests/`'s flat-permission
  pattern as this bullet originally planned.
- Signal-receiver tests per `request_type` (Step 5) — done:
  `attendance/tests/test_approvals_integration.py`, `leave/tests/
  test_approvals_integration.py`, mirroring `example_leave`'s own.
- **A concurrency test on `LeaveBalance` updates — done, and it found a real,
  live bug, not just a hypothetical one.** Every `LeaveBalance` mutation site
  across `leave/views.py` (request creation), `leave/handlers.py` (approval
  decisions), `leave/balances.py` (carry-forward seeding), `attendance/
  penalisation.py` (auto-applied deduction), and `attendance/
  penalisation_views.py` (overturn reversal) was a plain read-modify-write with
  no row locking — two concurrent writers to the same balance could silently
  lose one's update (and, for request creation specifically, let an employee
  over-draw their balance via the race, not just corrupt a number). Fixed with
  `transaction.atomic()` + `select_for_update()` at all five sites (`of=
  ("self",)` where the query also joins a nullable FK — Postgres refuses to
  lock across a LEFT OUTER JOIN otherwise). `leave/tests/
  test_balance_concurrency.py` proves it with two real threads (own DB
  connections, `transaction=True`) submitting simultaneous auto-approved
  requests against the same row — confirmed to genuinely fail without the fix
  (temporarily reverted, reproduced the exact predicted lost update, restored)
  before being trusted.
- Idempotency tests for the scheduled mechanism Step 7 settled on (a plain
  management command, no task queue) — done: `roll_leave_balances`
  (Step 7) and `apply_penalisations` (Step 8) each have a dedicated
  idempotency test, plus the underlying `get_or_seed_balance`/auto-apply
  functions are tested directly for the same property.
- End-to-end verification against 1.5's inventory, per tier — done
  continuously throughout Steps 6–9 as each piece landed (every real
  endpoint in this plan was verified live against the actual dev server
  through the real Next.js proxy, as Employee/Manager/HR Admin accounts,
  before being marked done — not deferred to one final pass at the end).
- Repo-wide checks (`manage.py check`, `ruff check .`, `black --check .`,
  `pytest`) — clean throughout; 541 tests pass as of this step.

### Definition of done — met

Every bullet above is either done with tests to show it, or — the conformance
kit — deliberately, explicitly not done, with the architectural reason
recorded rather than silently skipped or forced. The one thing this pass
changed outside of tests themselves is a real correctness fix (the
`LeaveBalance` locking), found by writing the concurrency test this step
already called for, not a pre-existing item on this plan.

---

## Explicitly out of scope

- Anything not present in the current frontend, added because it would be
  generically useful (configurable weekly-offs, multi-level org-chart rollups
  beyond whatever 10.2's manager-vs-team decision resolves to, an audit UI beyond
  the existing `write_audit` primitive) — none of this is requested by any
  current screen.
- Redesigning the pre-existing, separate `/calendar` company-wide page or the
  Home dashboard's holiday/leave widgets. **Open decision, carried forward —
  duplicate holiday data**: the frontend has two independent read paths for
  holidays — `leaveApi.getHolidays(year)` (that separate page + a Home widget,
  sharing the `/leave` proxy prefix) and `calendarApi.getEntries({type:
  'holiday'})` (Calendar Management, this module, already real). Whether the
  real backend should back both from one source of truth or keep them separate
  is undecided — worth resolving before Step 4 builds `leave`'s holiday read, to
  avoid two holiday lists that can silently disagree — but this plan's `leave`
  work does need to keep serving that existing page/widget either way, and their
  own UX is owned elsewhere.
- Any change to `core/`, `accounts/`, `employees/`, or `approvals`/`notifications`/
  `documents` themselves (§0) — including the specific case of absconding
  touching `Employee.status` (Step 8), which is flagged rather than assumed.
- Building a new task queue/cron mechanism speculatively — Step 7's scheduled-job
  decision should pick the simplest thing that satisfies Steps 3/7/8, not add
  infrastructure for its own sake.
