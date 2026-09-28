# ORG Module — Frontend UI Build (stubs only, no backend)

Source: 4AT_HRMS_ORG_Module_Functional_Scope_UI_Guide (Sept 2026 hand-off).
Branch: `organization`. FRONTEND ONLY — no Django/backend. All data is MOCK;
all actions are stubs (no persistence). Reuse existing Employee Directory,
Org Tree/Chart and RBAC — do NOT rebuild them.

## Nav (add one "Org" sidebar item with these sections/sub-items)
- **Overview** — landing dashboard
- **Employees** → Employee Directory (exists) | Organization Tree (exists)
- **Org Structure** → Legal Entities | Business Units | Locations | Departments | Teams
- **Job Architecture** → Job Families | Job Titles/Designations | Levels | Grades/Bands | Positions
- **Onboarding** → Preboarding | New Joiners | Onboarding | Tasks/Templates | Background Verification
- **Org Changes** → Promotions | Department Transfers | Location Transfers | Position Changes | Manager Changes
- **Settings** → Org Configuration | Hierarchy Rules | Naming/Codes

Recommended hierarchy: Legal Entity → Business Unit → Location/Department → Team → Position → Employee.

## Screens (key components)
- **ORG Overview**: KPI cards (Total Employees, Departments, Locations, Total Positions, Vacant Positions); Headcount by Department chart; Location summary; Position status (Filled/Vacant/Hiring/On Hold); Recent org changes list; Quick actions (RBAC-gated).
- **Organization Tree**: search (employee/position/department), expand/collapse branches, employee/position cards (name, designation, dept, location), click → existing Employee profile. REUSE existing OrgChartTab / org page.
- **Legal Entities / Business Units / Locations**: search/filter, data table, Add/Edit/Set-Inactive actions (stub modals).
- **Departments & Teams**: hierarchy-aware list, department head, employee/team counts, status.
- **Job Architecture**: tabbed list screens for Family, Title, Level, Grade/Band; Positions.
- **Positions**: filters; columns Position ID, Title, Department, Level, Reports-to, Status, Incumbent. A Position exists even when vacant.
- **Preboarding**: stage tabs, candidate list, DOJ, position/org assignment (select from ORG masters), document/BGV readiness.
- **Onboarding**: new-joiner progress, template/checklist, owners, tasks, status.
- **Org Changes**: change-type/date filters; From/To, Effective Date, Status, Changed By, audit trail.
- **Settings**: hierarchy config, naming/code conventions, relationship rules.

## Build sequence (from the doc's MVP priority)
1. Org Structure masters (Legal Entities, BUs, Locations, Departments, Teams)
2. Job Architecture (Families, Titles, Levels, Bands, Positions)
3. Map Employee Directory to ORG masters (reuse)
4. Reporting hierarchy / Org Tree (reuse)
5. Preboarding & Onboarding
6. Org Changes (effective-dated history)
7. ORG Overview dashboard (reads from the above)

Dev note from the doc: don't start with the dashboard — build masters first; the
Org Chart and dashboard read from that data. Here (frontend/mock) that means the
Overview reads the same mock master data the structure screens use.

## Reuse map (already in the repo)
- `frontend/src/app/(app)/org/page.tsx` — directory + org chart
- `frontend/src/components/admin/org/`: StructureTab, OrgChartTab, EmployeesTab, EmployeeDrawer, useOrgData
- RBAC: `useRequireAccess`, `hasPermission` (gate Org screens/actions, don't hard-code roles)
