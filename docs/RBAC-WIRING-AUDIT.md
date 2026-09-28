# RBAC & Wiring Audit — 2026-09-26

Triggered by: denying `ess.profile.read` and `example_leave.read` on a user
changed nothing visible. This audit separates **RBAC enforcement** (does the
backend check the permission?) from **wiring** (can the frontend even reach the
backend?). They are different failures with the same symptom on screen.

Method: read every backend `*/views.py` for its permission class, listed all 21
registered permission codes, and probed each frontend proxy target against the
running backend as an authenticated user.

---

## 1. RBAC core — implemented and enforced ✅

`core.scope` (resolver) + `core.permissions.ScopedEmployeePermission` /
`HasPermissionCode` are wired and enforced on the core modules. 200 tests pass;
scope actually filters (admin sees 146, a scoped user sees fewer, out-of-scope =
403).

| Module | Permission class | Codes enforced |
|---|---|---|
| employees (directory, personal, ESS) | ScopedEmployeePermission / HasPermissionCode + manual check | employees.read/write, employees.personal.read/write, ess.profile.read/write |
| org viewsets | HasPermissionCode | org.manage |
| orgchanges | ScopedEmployeePermission + manual | orgchanges.read/write, org.manage |
| payroll | HasPermissionCode/scoped | payroll.read/write/manage |
| approvals | manual `user_has_permission` | approvals.manage |
| accounts (roles/permissions) | HasPermissionCode | roles.manage |
| audit | scoped | audit.read |
| example_leave (reference) | ScopedEmployeePermission | example_leave.read/write/approve |

**Correction to an earlier claim:** `ess.profile.read/write` ARE enforced — the
ESS view raises 403 without the code (employees/views.py `EssProfileView`). The
reason denying it looked like a no-op: the **profile page** renders the user's
name/role from the login session object, not from the gated ESS endpoint, so the
visible header shows regardless. The API itself is correctly gated.

## 2. Enforcement gap — onboarding (peer module) ⚠️

Every `onboarding/views.py` viewset is `permission_classes = [IsAuthenticated]`.
The codes `onboarding.read / write / manage` are declared but **nothing checks
them** — any logged-in user hits those endpoints. This is the teammate's module;
per standing scope we leave it as-is, but noting it: onboarding is authenticated,
not authorized.

## 3. Wiring gaps — frontend proxy targets that 404 (the real cause of "Upstream error")

Probed each proxy prefix against the backend as admin:

| Proxy prefix | Backend target | Status | Verdict |
|---|---|---|---|
| notifications | /api/v1/notifications/ | 200 | OK |
| org-changes | /api/v1/org-changes/ | 200 | OK |
| payroll/inputs | /api/v1/payroll/inputs/ | 200 | OK |
| payroll/setup | /api/v1/payroll/setup/ | 200 | OK |
| requests | /api/v1/requests/ | 200 | OK |
| **leave** | /api/v1/leave/... | **404** | path mismatch — backend serves `example-leave/*`, and even then only `requests` (no types/balance/holidays). Built for a full leave backend that doesn't exist. |
| **attendance** | /api/v1/attendance/ | **404** | no backend app at all (peer). |
| **policies** | /api/v1/policies/ | **404** | no backend. |
| community | /api/v1/community/ | **404** | no backend (no sidebar entry; used by `engage` mock). |
| onboarding | (probe path) | 404* | mounts under a sub-path; verify before calling broken. |
| exits | (probe path) | 404* | teammate's; verify. |

`timesheet` has no backend either (5-line stub), same class as attendance.

**Why the deny tests misled:** the leave page was 404 the whole time, not 403.
The frontend collapses any non-2xx into "Couldn't load … / Upstream error", so a
missing route and a permission denial look identical on screen.

---

## Fixes applied (this change)

1. Hidden the no-backend nav entries so they stop faking a feature: **attendance,
   leave, timesheet** (sidebar) and **policies** (Org submenu) in
   `frontend/src/app/(app)/layout.tsx`; the broken dashboard quick-actions
   (Apply Leave, Request WFH, Regularize, Timesheet) in `QuickActions.tsx`.
   Each is documented in-place; re-add when its backend lands.
2. Left `ess.profile.*` backend untouched — already enforced.
3. Left onboarding/exits (peer) untouched per standing scope.

## Not done (needs a decision)
- **Leave**: wire the frontend to the real (peer) leave backend when it exists,
  or build one. The `example_leave` reference is intentionally minimal and
  "never in production", so it is not a drop-in.
- **Frontend error copy**: pages should show "You don't have access" (403) vs
  "Not available yet" (404) instead of one generic "Upstream error".
- **expenses / performance / engage / team**: mock/stub surfaces flagged in
  `docs/HRMS-GAP-ANALYSIS.md`; same hide-or-build decision.
