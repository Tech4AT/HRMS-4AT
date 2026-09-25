# Attendance & Leave — Backend Implementation Plan

Status: **Calendar (Step 2) is built, tested, and verified live. Steps 3–12 are
planning only** — nothing else described below has been implemented.

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
in the frontend — it auto-applies once a grace period lapses, and the only
"decision" a human makes is reviewing an overturn request, which today (Approvals
→ Penalisation tab, `lib/attendance/penalisation.ts`) is a direct
apply/overturn state machine (`applied` → `overturn_requested` → `overturned`),
not a raise-then-decide flow with a routed approver. **Do not force Penalisation
onto `approvals.Request`.** Keep its existing domain-specific lifecycle as its
own model with its own status field and its own permission-gated review actions
(Step 8). If a future requirement makes Penalisation's overturn review look more
like a routed approval, that's a deliberate, separately-agreed change — not
something this plan does by default for consistency's sake.

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

## Step 6 — Shifts and policy settings backend

### Models

- `Shift`: name, start time, end time, break minutes.
- Shift assignment: either an `employee` FK directly on a join model or a M2M —
  matches the frontend's `Shift { ..., employeeIds }` shape either way; pick
  whichever is more idiomatic once building (not dictated by the frontend).
- `PolicySettings`: a single-row (or singleton-pattern) model — regularisation
  grace period, absconding threshold, and per-rule (No Attendance / Late Arrival
  / Early Leaving / Work Hours) enabled flag + numeric fields, plus Comp Off
  accrual enabled flag + rate — matches `PolicySettings`/`PenalizationSettings` in
  `lib/attendance/penalisation.ts` exactly.

### CRUD / API endpoints

Full CRUD on Shifts and assignment; read + update on the single Policy Settings
row. Not employee-keyed data (Shifts/Settings themselves — assignment involves
employee references but the shift record isn't scoped per-employee the way
`AttendanceRecord` is) — follow `org_calendar`'s `HasPermissionCode` +
`EnvelopeMixin` pattern (Step 2/1.4), not `ScopedEmployeePermission`.

### RBAC

`attendance.settings.manage` — **already the exact hardcoded frontend string**
gating Shifts, Leave Settings, and Policy Settings (1.6). Per the registry rule
(one owning registration; identical duplicate registrations are harmless,
conflicting ones raise at import time — Step 10), exactly one app should
register this code; the others reference it in their own views without
re-registering it. Which app owns the registration is an implementation detail
to settle when app boundaries are drawn (this plan describes by frontend feature
area, not by fixed Python app count).

### Approvals integration

None — Shifts and Policy Settings are admin configuration, not a request/decision flow.

### Notifications / audit

`write_audit` on every create/update/destroy, same as `org_calendar`. No notifications.

### Tests

Same shape as `org_calendar`'s suite: permission wiring, CRUD, RBAC wiring checks.

### Definition of done

Shifts CRUD + assignment and Policy Settings match their frontend contracts;
`attendance.settings.manage` gates all of it with a single owning registration;
verified live against Settings → Shifts / Policy Settings with `MOCK_AUTH` off.

---

## Step 7 — Leave balances & accruals

Builds on `LeaveBalance` (Step 4's model) — this step is specifically opening
balance seeding, carry-forward computation, and Comp Off accrual, none of which
the frontend actually computes anywhere today.

### Services / business logic

- Opening-balance seeding (new financial year, new employee) and carry-forward
  computation at year-end.
- **Open decision, carried forward — Comp Off accrual mechanics**: Policy
  Settings has an enabled flag and an "N overtime hours = 1 Comp Off" rate, but
  not *when* that's evaluated (rolling daily total? weekly? monthly?) or *how* a
  credited day is applied (added to a Comp Offs `LeaveBalance` the same way any
  other allocation is, or tracked separately). The frontend never performs this
  calculation anywhere — it's descriptive policy text today, not an implemented
  computation.
- **Open decision, carried forward — scheduled/background work**, shared with
  Steps 3 and 8: no task queue, Celery, or cron mechanism exists anywhere in this
  repo (`docker-compose.yml`/`requirements.txt` confirmed clean of any, still
  true post-merge). Accrual evaluation, attendance-day finalization (Step 3), and
  Penalisation auto-apply (Step 8) all need *something* to run outside a single
  HTTP request. What triggers it (management command + external cron, a
  scheduled container, a task queue introduced for this purpose), at what
  cadence, and covering exactly which of these three moments, is undecided —
  resolve once, as shared infrastructure, not three separate times per step.

### CRUD / API endpoints

Admin edit on `LeaveBalance` (already in Step 4's endpoint set) plus whatever
read/write Comp Off accrual needs once its mechanics are decided.

### RBAC

Same `attendance.settings.manage` gate as Leave Balances admin editing already
implies (1.6, Step 6) — no new permission code needed unless Comp Off accrual
ends up as a separate concern.

### Approvals integration

None — accrual and carry-forward are computed, not requested/approved.

### Notifications / audit

`write_audit` on every balance mutation, including accrual credits (so "why did
this balance change" stays answerable per row, same standard as everywhere else).

### Tests

Idempotency of whatever scheduled mechanism gets chosen (running it twice must
not double-credit); accrual math once the cadence/application decision is made.

### Definition of done

Opening balances and carry-forward compute correctly across a year boundary;
Comp Off accrual (once its mechanics are decided) credits exactly once per
qualifying period; the shared scheduled-job mechanism is decided and in place
before this step is considered complete, since it has no other consumer yet at
this point in the build order.

---

## Step 8 — Penalisation

**Not built on the approvals engine** (1.3) — this is the one area where the
prior domain-specific design is preserved deliberately, not superseded by the
engine.

### Models

`PenalisationRecord`: `employee` FK, absence date, deadline, reason, `status`
(`applied` | `overturn_requested` | `overturned`), overturn request reason/date,
overturned-by/reason — matches `PenalisationRecord` in
`lib/attendance/penalisation.ts` exactly. Policy configuration itself
(regularisation grace period, absconding threshold, per-rule flags, Comp Off
rate) is `PolicySettings`, already covered in Step 6.

### Services / business logic

- Auto-apply is triggered by the same shared scheduled mechanism as Step 7 (once
  a regularisation grace period lapses with no attendance) — no approval step for
  the initial `applied` state, matching the frontend's "automatically" language.
- Overturn request → review is a **direct two-party state machine**
  (`overturn_requested` → `overturned`, or a rejection back to `applied`) with its
  own permission-gated review action — not a raise-then-route-to-manager flow,
  since there's no "requester's manager" concept here in the way Leave/WFH/
  Regularisation has one; the reviewer is whoever holds the review permission
  (Step 10), scoped like any other manager/HR action.
- **Open decision, carried forward — leave-day deduction**: "1 day leave
  deducted for every no-attendance day" is currently read-only descriptive text
  (Policy Settings sentence, Attendance Policy popup) — no UI performs an actual
  deduction. Whether applying a `PenalisationRecord` should deduct a real
  `LeaveBalance` (Step 4/7), and against which leave type, is undefined by the
  frontend.
- **Open decision, carried forward — absconding behaviour**: an "absconding
  threshold" (consecutive absent days) exists in Policy Settings, but nothing in
  the frontend shows what happens once it's crossed — no UI reads or reacts to an
  "absconded" state. Whether this should affect `Employee.status` (currently
  `active`/`on_leave`/`exited`, defined in `core/enums.py`, outside this module)
  is undefined, and any change to that shared enum is a deliberate, separately-
  agreed core change (§0), not something this module decides unilaterally.

### CRUD / API endpoints

Match `lib/attendance/penalisation.ts`'s shape: list (scoped), overturn-request
(employee, own record), review actions (approve/reject the overturn, direct
overturn) for whoever holds the review permission.

### RBAC

The Approvals → Penalisation tab **currently has no permission gate at all**
(1.6) — a real permission code is required here regardless of frontend
precedent, since real scoped data needs real enforcement (`core.E001`–`E004`
demand it the moment a real view exists). This is new — there is no existing
hardcoded frontend string to match, unlike `leave.approve`/`attendance.approve`.
Follow the `<module>.<action>` convention (e.g. `penalisation.review`), scoped
per Step 10's manager-vs-team decision.

### Approvals integration

Explicitly none, per 1.3 — do not route Penalisation through
`approvals.create_request()`.

### Notifications / audit

Auto-apply and every overturn-review action call `write_audit`; notify the
employee on auto-apply and on overturn decision (via `notifications.service.notify`
directly, the same primitive the approvals engine itself uses internally — no
need to invent a different notification mechanism).

### Tests

State-machine tests for the three statuses and their legal transitions;
permission tests for the new review code once it's registered; a scheduled-job
idempotency test shared in spirit with Step 7's.

### Definition of done

Auto-apply runs on schedule and matches Policy Settings' rules; overturn
request/review works end to end with a real permission gate (closing the
"visible to anyone who can see Approvals" gap noted in 1.6); verified live
against Approvals → Penalisation with `MOCK_AUTH` off.

---

## Step 9 — Dashboard / derived data where actually needed

No dedicated storage for the Dashboard itself. Every number today (present/late/
on-leave/WFH counts, weekly trend, leaderboard, roster) is computed client-side
over a fake roster (`lib/attendance/dashboard.ts`); once Steps 3–8 are real, the
same client-side computation can run over real scoped data — **if** the
underlying APIs expose a scoped multi-employee list, which none of them do today
(today's `attendanceApi.getHistory()`/`leaveApi.getRequests()` are self-only, by
frontend design, since only the individual's own page ever called them).

- **Open decision, carried forward**: the read shape for "give me my team's
  data" — a dedicated multi-employee list endpoint per module, an `employee_id`/
  scope query parameter added to the existing self-only endpoints, or something
  else. Not dictated by the frontend, which currently reads a fake in-memory
  roster instead of calling any API for this.
- Whatever shape is chosen should reuse Step 10's scope resolution
  (`resolve_management_scope`-style) rather than the Dashboard inventing its own
  team-membership logic.

### Definition of done

Dashboard reads real scoped data instead of the sample roster, via whichever
read shape Step 10's scope work makes available; `lib/attendance/sample-employees.ts`
becomes removable (Step 11).

---

## Step 10 — RBAC and scope verification

Consolidates every permission decision touched above into one pass, once all
the modules exist, to check the whole set is consistent.

### 10.1 Permission set, by source of obligation

**Already hardcoded in the frontend (1.6) — must exist with these meanings:**
`leave.approve`, `attendance.approve` (both now nav-gates only, per Steps 3–4 —
not consumed by the approvals engine's own decision logic), `calendar.manage`
(Step 2, done), `attendance.settings.manage` (Step 6, single owning registration).

**Required by RBAC enforcement, not named by the frontend (1.6, Steps 3–4):** a
read/write code pair for Attendance and one for Leave — name per the
`example_leave` convention, since nothing else dictates it.

**New, no existing precedent either way (Step 8):** a Penalisation overturn-review
permission code.

**Already registered, no action needed:** `approvals.manage` (HR Admin + Finance,
`ScopeTier.ALL` — the reassign/force-resolve escape hatch, Step 5).

### 10.2 Tier mapping (explicit task requirement, restated)

| Tier | Sections | Minimum permissions |
|---|---|---|
| Basic Employee | My Attendance only | Self-scoped read/write codes from Steps 3–4 — no `*.approve`, no penalisation-review code, no `calendar.manage`/`attendance.settings.manage` |
| Admin / Team Manager | Dashboard (their scope), My Attendance, Approvals (their scope) | Everything above, plus `leave.approve`/`attendance.approve` (nav) + the penalisation-review code, scoped to reports — no `calendar.manage`/`attendance.settings.manage` |
| HR Manager | Everything, incl. Settings | Everything above at broadest scope, plus `calendar.manage` and `attendance.settings.manage` |

Maps onto the already-seeded `Employee`/`Manager`/`HR Admin` roles, no new roles required.

- **Open decision, carried forward — manager vs. team scope**: whether "their
  team/reports" resolves to `ScopeTier.MANAGER` (direct reports only) or
  `ScopeTier.TEAM` (full recursive subtree). Both exist and work today; nothing
  in the task wording or the frontend (no multi-level reporting UI) disambiguates
  a manager-of-managers case. Pick one when assigning `default_grants` for the
  codes in Steps 3, 4, and 8.

### 10.3 Registry hygiene

Verify no permission code ends up registered from two apps with different
`default_grants`/descriptions (raises at import time, per `core/registry.py`) —
particularly `attendance.settings.manage` if Shifts/Leave Settings/Policy
Settings land in separate apps (Step 6).

### 10.4 Cleanup, optional, no functional dependency

The vestigial `'scope.all'` string (1.6) — `hasOrgScope()` already covers what it
was meant for in the same `||` condition it appears in.

### Definition of done

Every permission code above exists, is registered exactly once, and the tier
table holds exactly when tested (Step 12) as three real accounts, one per tier.

---

## Step 11 — API / proxy integration

- New Next.js proxy routes for Shifts and Penalisation, using the existing
  `createBackendProxyRoute(prefix)` one-liner already used by `leave`/
  `attendance`/`calendar` — no new pattern to invent.
- `lib/attendance/shifts.ts` + its employee picker: replace local sample data
  with a real API client and the existing, already-real `/api/v1/employees` list
  — Shifts should not get its own duplicate employee directory.
- `lib/attendance/penalisation.ts`: replace the `localStorage`-backed hooks with
  a real API client; every consumer keeps its current shape, fed from the
  network instead.
- `approvals/page.tsx`: add the new permission gate to the Penalisation tab
  (Step 8/10.1) — currently ungated.
- `lib/attendance/dashboard.ts`/`AttendanceLeaderboard.tsx`: replace sample-roster
  generation with real aggregation, once Step 9's read shape is decided.
- `lib/attendance/sample-employees.ts`: removable once Shifts and Dashboard both
  read the real employee directory.
- **No change needed** to `leave/page.tsx`, `me/attendance/page.tsx`,
  `CalendarManagementPanel.tsx`, `approvals/page.tsx`'s existing To-approve/My-requests
  tabs, or `lib/api/requests.ts` — they already call real clients against
  existing or soon-to-exist proxy routes; turning off `MOCK_AUTH` per prefix, one
  area at a time, is the only remaining step for each as its backend lands.
- Optional: the `'scope.all'` cleanup (10.4).

### Definition of done

Every prefix (`leave`, `attendance`, `calendar`, `requests`, plus new `shifts`/
`penalisation` routes) runs with `MOCK_AUTH` off against the real backend with no
frontend behaviour change from the user's point of view.

---

## Step 12 — Testing and verification

- Follow the existing conformance pattern (`MODULE-GUIDE.md`,
  `example_leave/conformance.py`, `run_conformance`/`assert_module_conforms`) for
  every `ScopedEmployeePermission`-gated view built in Steps 3–4: registered
  permissions, 401 anonymous, 403 permission-less, correct record set per scope
  tier, in-scope detail opens / out-of-scope 403s, per-user override beats a role
  grant, writes require the write permission, record ownership always comes from
  the authenticated user not the request body, every custom action individually
  permission-checked. Existing infrastructure, not new work to design.
- For `HasPermissionCode`-gated flat views (Calendar — done; Shifts, Policy
  Settings, Step 6), follow `org_calendar/tests/`'s pattern instead: plain
  pytest-django functional tests plus a small RBAC-wiring test, since the
  conformance kit's scope-tier assertions don't apply to non-employee-keyed data
  (confirmed no existing precedent applies the conformance kit to this shape —
  `payroll`'s own flat `payroll.manage` views also have no conformance test).
- A signal-receiver test per `request_type` (Step 5), proving the decision lands
  on the correct domain row exactly once, mirroring
  `example_leave/tests/test_approvals_integration.py`.
- A concurrency test on `LeaveBalance` updates (Step 4/7).
- Idempotency tests for whatever scheduled mechanism Step 7 settles on (accrual,
  attendance finalization, Penalisation auto-apply all share it).
- End-to-end pass against 1.5's inventory table, one row at a time, logged in as
  each of the three tiers (10.2) separately — the acceptance test for "the
  frontend is the source of truth" actually holding, not just individual
  endpoints working in isolation.
- Existing repo-wide checks (`manage.py check`, `ruff check .`, `black --check .`,
  `pytest`), unchanged, already required by `MODULE-GUIDE.md`'s checklist.

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
