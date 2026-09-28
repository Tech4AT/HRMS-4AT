# ORG Module — Implementation Backlog

Source: `4AT_HRMS_ORG_Module_Functional_Scope_UI_Guide.docx` (Dev hand-off, Sep 2026).
Goal: implement the ORG module for real — build missing backend masters + change
tracking, then wire every org-module screen to real data (replace mock). Follow the
docx §12 MVP order: **build masters & relationships first, dashboard last.**

Branch: `organization`. Real DB (146 employees) preserved; all migrations additive.
Commit author Nandini Velamuri <krishnanandiniv@gmail.com>, no AI mentions.

## State today
- **Backend HAVE:** LegalEntity, BusinessUnit, Location, Department(+parent),
  Designation, CostCenter, Employee — with `org/*` admin viewsets (camelCase, audited)
  and read-only snake_case lists. Onboarding app integrated. Approvals engine. RBAC.
- **Backend MISSING:** Job Architecture (JobFamily, Level, Grade/Band, Position),
  Team model, Org Changes (effective-dated promotions/transfers/position/manager).
- **Frontend:** all 24 `org-module/*` screens exist as stubs on mock data
  (`lib/mock/org/*`). Overview KPIs + Org Structure lists already wired to real data
  (ORG-REAL). Employee directory/profile done (EMP-P0).

---

## Backlog (waves respect dependencies + avoid merge conflicts)

### WAVE 1 — Backend foundation (unblocks everything) — 1 worker, backend only
- **ORG-1B** Team model: `Team(name, department FK, lead FK→Employee, is_active)` +
  admin CRUD (`org/teams`) + read list. (Docx treats Teams as distinct below Dept.)
- **ORG-2B** Job Architecture models (all SoftDelete/named where sensible):
  `JobFamily`, `Level`, `Grade`, `Position`. Position = approved seat independent of
  employee: fields dept FK, job_title(Designation) FK, level FK, grade FK, reports_to
  (self/Position) FK, status ∈ {filled, vacant, hiring, on_hold}, incumbent(Employee)
  nullable. Admin CRUD + read lists following the existing employees viewset pattern.
- **ORG-3B** Employee additive FKs → `position`, `level`, `grade` (nullable, migration
  additive). Mirror onto directory serializer.
- **ORG-6B** Org Changes: new app `orgchanges` with an effective-dated `OrgChange`
  model — type ∈ {promotion, dept_transfer, location_transfer, position_change,
  manager_change}, employee FK, from_value/to_value (FK or json), effective_date,
  status ∈ {pending, effective, cancelled}, changed_by, audit timestamps. CRUD
  endpoints + a management action to apply due changes on/after effective_date.
- Seed a handful of rows (job families, levels, a few positions) so the frontend has
  real data. **Backend only, additive migrations, preserve DB.**

### WAVE 2 — Frontend wiring (after Wave 1 merges) — 2 workers, no file overlap
- **ORG-1F / ORG-2F** (Worker A): wire Org Structure screens (legal-entities,
  business-units, locations, departments, teams) + Job Architecture screens
  (job-families, job-titles, levels, grades, positions) to the real endpoints —
  data table, search/filter, Add/Edit/Inactive. Replace mock imports.
- **ORG-6F / ORG-5F / ORG-4F** (Worker B): wire Org Changes screens (promotions,
  dept-transfers, location-transfers, position-changes, manager-changes) to
  `orgchanges` API with From/To/effective-date/status/audit; wire Onboarding screens
  (preboarding, new-joiners, onboarding, tasks, bgv) to the onboarding API selecting
  assignments from ORG masters (no free-text duplicates); enhance Org Tree
  (`/org?tab=chart`) — search by employee/position/dept, expand/collapse, position
  cards, profile drill-down, RBAC scope.

### WAVE 3 — Dashboard + settings + polish — 1 worker
- **ORG-7** Overview: add Total/Vacant Positions KPIs, position status
  (filled/vacant/hiring/on-hold), recent org changes, quick actions gated by RBAC —
  now that Positions + Org Changes exist.
- **ORG-8** Settings: org configuration, hierarchy rules, naming/codes (backend config
  + wire screens).
- **ORG-9** UI-principle pass over the whole ORG module: consistent table/card/drawer,
  states, a11y, responsive; remove any remaining mock.

## Definition of success (docx §15)
Org data maintained once, reused everywhere; Employee Directory + RBAC stay the
foundation; preboarding uses ORG masters (no duplicate free-text); Org Chart from real
reporting data; Positions exist independent of employees; Org changes effective-dated
and auditable.
