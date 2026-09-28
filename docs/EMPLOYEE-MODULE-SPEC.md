# Employee Module — Completeness Spec & Build Plan

Benchmark: Keka. Scope: the Employee module only (backend functionality + frontend).
Goal: one non-redundant, functional, polished employee experience. Report + build
plan; no implementation in this doc.

Branch: `organization`. Real DB: 146 employees / 17 departments — preserve it.

---

## A. Current backend state — mostly complete

`backend/employees/` (models.py, views.py, serializers.py, urls.py).

| Capability | Endpoint | State |
|---|---|---|
| Directory list (scoped) | `GET /api/v1/employees/` — filters `?department= ?location= ?status= ?no_manager= ?search=` | HAVE |
| Employee detail (scoped, 403 out-of-scope) | `GET /api/v1/employees/{id}/` | HAVE |
| Create | `POST /api/v1/employees/` (`employees.write`) | HAVE |
| Update | `PATCH /api/v1/employees/{id}/` (`employees.write`) | HAVE |
| Exit / reactivate lifecycle | PATCH status→`exited` revokes sessions + sets exit date; reverse restores | HAVE |
| Personal details (guarded) | `GET/PATCH /api/v1/employees/{id}/personal/` (`employees.personal.read/.write`) | HAVE |
| Self-service profile (ESS) | `GET/PATCH /api/v1/ess/profile/` | HAVE |
| Company-wide org directory | `GET /api/v1/org-directory/` (unscoped, read-only, powers chart) | HAVE |
| Reference lists | departments, designations, locations, legal-entities, business-units, cost-centers | HAVE |
| Structure admin (audited) | `org/departments` etc. (`org.manage`) | HAVE |

**Backend gaps (models exist, no REST for the employee profile):**
- `BankDetails`, `IdentityDocument`, `EducationRecord`, `EmployeeLetter` — models present
  (migration 0005) but exposed only through the onboarding app, not as employee-profile
  sub-resources. A full profile page needs read/write endpoints for these under
  `/api/v1/employees/{id}/{bank|identity|education|letters}/` (scoped like `personal`).
- No profile photo field on Employee (Keka has one).
- No emergency-contact model (Keka has one).

Serializer note: `/employees` returns **snake_case** in `{success, data}`; most other
APIs are camelCase. Keep employee build on snake_case to match what's live; do not
re-shape mid-build.

---

## B. Current frontend state — redundant and incomplete

**Four overlapping employee surfaces:**

| Route | Lines | Data | Role |
|---|---|---|---|
| `/org` | 827 | real (`/api/org-directory` + all lists) | Directory + Org Chart + Documents tabs. The rich one. |
| `/employees` | 211 | real (`/api/employees`) | Read-only card grid + client search. **Documents tab is hardcoded fake links.** superadmin "All Employees". |
| `/org-module/employees` | 53 | none | Link hub pointing at the other three. Pure redundancy. |
| `/manage-org` | 134 | real (`components/admin/org/*`) | Admin CRUD: EmployeesTab, EmployeeDrawer (add/edit), StructureTab, OrgChartTab. |

Admin add/edit already exists in `components/admin/org/EmployeeDrawer.tsx` +
`EmployeesTab.tsx` + `useOrgData.ts`, reachable only via `/manage-org`.

**Missing entirely:**
- Employee **profile detail page** — click a person → full profile (job, personal,
  bank, documents, education, letters, emergency contacts). Backend supports most; no UI.
- Server-side filters wired to the directory (dept/location/status chips exist in API,
  not in the main grid).
- Exit/reactivate action surfaced in the UI (backend does it; no button).
- Profile photo / avatar anywhere.

**Nav (layout.tsx "Org" item)** lists Employee Directory (`/org?tab=directory`),
All Employees (`/employees`), Manage Structure (`/manage-org`) — three doors to the
same data.

---

## C. Keka benchmark — HAVE / PARTIAL / MISSING

| Keka employee feature | Ours |
|---|---|
| Employee directory (search, filter, card/list toggle) | PARTIAL — grid + search, no server filters, no list view |
| Employee profile (job info) | PARTIAL — data in API, no dedicated profile page |
| Personal info tab | PARTIAL — endpoint exists, no UI |
| Bank details tab | MISSING UI (model only) |
| Documents tab (real uploads) | MISSING — current tab is fake links |
| Education / qualifications tab | MISSING UI (model only) |
| Identity documents tab | MISSING UI (model only) |
| Letters (appointment/appraisal) tab | MISSING UI (model only) |
| Emergency contacts | MISSING (no model) |
| Profile photo/avatar | MISSING (no field) |
| Add employee | HAVE (`/manage-org` drawer) |
| Edit employee | HAVE (`/manage-org` drawer) |
| Exit / offboard | HAVE backend; MISSING button |
| Org chart with reporting hierarchy | PARTIAL — chart tab exists at `/org?tab=chart` |
| Self-service (ESS) profile | HAVE endpoint; PARTIAL UI |
| Bulk actions / import-export | MISSING |

---

## D. Redundancy to remove

1. **Delete `/org-module/employees`** (link hub) — nav points directly to the real screens.
2. **Collapse `/employees` into `/org`** — `/org?tab=directory` is the canonical directory.
   Keep ONE directory. Drop `/employees`' fake Documents tab. If a superadmin "all
   employees, unscoped" view is still wanted, make it a filter on `/org`, not a route.
3. **Fold `/manage-org` admin actions into the directory** — add/edit/exit should be
   actions ON the directory + profile page (gated by `employees.write`/`org.manage`),
   not a separate route. Keep the components (EmployeeDrawer etc.), drop the extra door.
4. Result: **one** employee area — directory (with filters + inline admin actions) +
   profile detail + org chart — reachable from a single nav entry.

---

## E. Build plan (dispatchable, ordered)

**P0 — one canonical directory + profile (frontend, uses existing APIs)**
- **EMP-B1** Delete `/org-module/employees`; repoint nav "Employee Directory" to `/org?tab=directory`; remove `/employees` route (or 301 → `/org`). Remove the fake Documents links. *FE. Accept: one directory route, no dead/fake tabs, nav has no duplicate employee doors.*
- **EMP-B2** Employee **profile detail page** `/org/[id]` (or `/employees/[id]`): header (name, code, designation, dept, location, status, manager) + tabs Job / Personal / Documents. Wire Job from `/employees/{id}`, Personal from `/employees/{id}/personal/`. Loading/empty/error states. *FE. Accept: click a directory row → real profile, personal tab gated.*
- **EMP-B3** Surface **admin actions** on directory + profile: Add (existing EmployeeDrawer), Edit, Exit/Reactivate (PATCH status) — gated by `employees.write`. *FE. Accept: HR can add/edit/exit from the directory without visiting `/manage-org`.*
- **EMP-B4** Server-side **filters** on the directory (department, location, status, no-manager) wired to the existing query params + a list/grid toggle. *FE.*

**P1 — full profile (needs small backend additions)**
- **EMP-B5** Backend: expose `bank`, `identity`, `education`, `letters` as scoped
  sub-resources under `/employees/{id}/` (reuse onboarding serializers; mask sensitive
  numbers as the models already do). *BE. Additive migration only if needed. Accept: read/write endpoints, audited, scoped.*
- **EMP-B6** Profile tabs: Bank, Documents (real `documents` app uploads), Education,
  Identity, Letters — read + edit per permission. *FE.*
- **EMP-B7** Profile photo: add `photo` ImageField to Employee (additive migration) +
  avatar in directory/profile/chart. *BE+FE.*

**P2 — polish + parity**
- **EMP-B8** Emergency-contact model + tab. *BE+FE.*
- **EMP-B9** Bulk export (CSV) of the directory; optional import. *FE (+BE export).*
- **EMP-B10** Org-chart hierarchy polish (expand/collapse, jump-to-self, export) if `/org?tab=chart` is thin. *FE.*
- **EMP-B11** UI-principle pass across the module: consistent table/card/drawer,
  spacing, empty/loading/error states, keyboard/a11y basics, responsive. *FE.*

**Do-not-break:** preserve the 146-employee DB; all migrations additive; commit author
Nandini Velamuri <krishnanandiniv@gmail.com>, no AI mentions.
