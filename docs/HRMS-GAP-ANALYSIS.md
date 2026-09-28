# HRMS Gap Analysis — HRMS-4AT vs Keka

Benchmark: [Keka HR](https://www.keka.com/). What a full HRMS has, versus what
this codebase implements today. Report only — no implementation.

Authored by god directly (the delegated research agent was reaped before writing).
Evidence = backend Django apps + frontend `(app)` routes on the `organization` branch.

## Legend
- **HAVE** — built and wired to real data.
- **PARTIAL** — some of it exists (backend-only, or a UI on mock/thin data).
- **MISSING** — route stub or nothing.
- **Owner** — *core* = ours to build (core module + frontend UI); *peer* = a
  teammate's data module (per the standing scope: peers own leave/attendance/payroll
  data; we build the core + UI).

---

## A. What we have (evidence)

**Backend apps:** accounts, core (RBAC/scope), approvals, audit, documents,
employees, notifications, onboarding, payroll, example_leave.

**Frontend routes, by wiring (line count / API calls):**
- Real data: `org` + `employees` (directory/chart), `approvals` (inbox UI), `payslips` (1062L, wired), `onboarding` (integrated), `admin` (access control).
- Partial / mock-heavy: `leave` (789L, 1 API call), `performance` (559L, 4 calls, no backend app), `engage` (1333L, 12 calls, no backend app), `calendar`, `me`/`profile`.
- Stubs (≤21 lines, 0 API): `attendance`, `expenses`, `timesheet`, `learning`, `career`, `reports`. `team` (256L) is mock.

---

## B. Keka module checklist vs ours

| Keka module | Our state | Owner | Evidence / note |
|---|---|---|---|
| Core HR — employee data, org, lifecycle | **PARTIAL** (backend HAVE; FE in progress) | core | `employees` app complete; FE being consolidated (EMP-P0 in flight). |
| **RBAC / access control** | **HAVE** (exceeds Keka) | core | `core.scope`, `admin` route. Our differentiator. |
| Approvals / workflows engine | **HAVE** | core | `approvals` app + inbox UI (APP-1..3). |
| Onboarding / pre-boarding | **HAVE** | core+peer | `onboarding` app integrated (ONB-INT). |
| Documents / letters | **PARTIAL** | core | `documents` backend HAVE; employee-profile document UI MISSING. |
| Employee self-service (ESS) | **PARTIAL** | core | `/ess/profile/` backend + `me`/`profile` routes; thin. |
| Payroll (India: TDS/PF/ESI/PT) | **PARTIAL** | peer | `payroll` app + `payslips`/`payroll-inputs`/`payroll-setup` UI; statutory depth unverified. |
| Leave management | **PARTIAL** | peer | `example_leave` reference engine + `leave` UI (mock-ish). Real leave module = peer. |
| Attendance (biometric/GPS/shifts) | **MISSING** | peer | `attendance` = 5-line stub, no backend. |
| Timesheet | **MISSING** | peer | stub. |
| Expenses / travel | **MISSING** | peer | stub. |
| Performance / OKR | **PARTIAL (mock)** | core-UI/peer | `performance` FE 559L, no backend app. |
| Recruitment / ATS | **MISSING** | peer | `career` = stub. |
| Engagement / surveys | **PARTIAL (mock)** | peer | `engage` FE 1333L, no backend app. |
| Analytics / reports | **MISSING** | core | `reports` = stub. |
| Helpdesk / employee support | **MISSING** | peer | `help` route only. |
| Asset management | **MISSING** | peer | none. |
| Mobile app | **N/A** | — | out of scope. |

---

## C. Prioritized gap roadmap (our lane: core modules + frontend UI)

Given the standing scope (we build **core modules + frontend UI**; peers own their
data modules), the gaps that are **ours** to close:

**P0 — Employee module complete** *(in flight, EMP-P0)*
- One canonical directory + profile page + inline add/edit/exit + filters. See
  `docs/EMPLOYEE-MODULE-SPEC.md`.

**P1 — finish the employee profile surface** *(core)*
- Profile tabs on real data: documents, bank, education, identity, letters (backend
  models exist; need scoped sub-endpoints + UI). Profile photo. Emergency contacts.

**P2 — remove whole-app UI redundancy & polish** *(core, the original ask)*
- Audit every route: delete/merge duplicate surfaces (like the 4 employee doors),
  label or remove mock-only screens (`performance`, `engage`, `team` run on mock with
  no backend), fix stub routes that look real in nav (`attendance`, `expenses`,
  `timesheet`, `learning`, `career`, `reports`). Decide: hide-until-built vs keep-as-stub.
- Apply consistent UI system (tables/cards/drawers, states, a11y, responsive) for a
  Keka-grade finish.

**Not ours (peer data modules)** — attendance, real leave, payroll statutory depth,
expenses, recruitment/ATS, engagement backend, helpdesk, assets. We provide the core
(RBAC, approvals engine, employee/org data, documents) they build on; the
leave/attendance integration note (`docs/LEAVE-ATTENDANCE-INTEGRATION.md`) already
tells them how to wire onto our approvals engine.

---

## D. Bottom line

- **Strong:** the *core* — RBAC, approvals engine, employee/org backend, onboarding,
  documents. This is the plug-and-play foundation, and it exceeds Keka on access control.
- **The real gap is the frontend:** many nav entries (`attendance`, `expenses`,
  `timesheet`, `performance`, `engage`, `reports`, `learning`, `career`) are stubs or
  mock-only with no backend, which is exactly the "redundant/inconsistent UI" problem.
- **Our path:** finish the employee module (P0/P1), then the whole-app UI cleanup (P2).
  The feature-depth modules (payroll/leave/attendance/etc.) are peer-owned data work
  that plugs onto our core.

Sources: [Keka HR](https://www.keka.com/), [Keka HR Software](https://www.keka.com/hr-software), [Keka on Wikipedia](https://en.wikipedia.org/wiki/Keka_HR), [Capterra: Keka](https://www.capterra.com/p/149253/Keka/).
