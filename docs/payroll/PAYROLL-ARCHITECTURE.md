# Payroll Module — Architecture

> Companion to `PAYROLL-ARCHITECTURE.html` (same content with rendered diagrams). This Markdown
> file is the canonical copy for coding agents — edit it, then run
> `node docs/payroll/build-html.mjs` to regenerate the HTML. For the runbook, UAT status,
> troubleshooting and feature detail see `PAYROLL-MODULE.md`.

## 1. Purpose and scope

The payroll module turns configuration (components, structures, statutory rules), people data
(employees, compensation) and monthly inputs (attendance, leave, bonus, OT, deductions) into an
**approved, locked, auditable payroll** and its outputs (payslips, bank advice, statutory files,
journal, reports).

Architectural goals, in priority order:

1. **Correctness & reproducibility** — the same inputs always produce the same result; any past
   payslip can be re-explained line by line.
2. **Control** — nothing becomes official without maker-checker approval; finalized payroll
   cannot change except through a privileged, audited reopen.
3. **Least privilege** — every read and write is permission- and scope-checked on the server.
4. **Fit the HRMS platform** — reuse the shared primitives (RBAC, audit, approvals,
   notifications, documents, attendance) instead of re-inventing them.
5. **Simplicity** — a modular monolith; no queues, services or engines beyond what the
   requirements need.

---

## 2. System context

```mermaid
flowchart TB
  EMP["Employee<br/>(views own payslips)"]
  PADM["Payroll Admin<br/>(configures, prepares runs)"]
  FIN["Finance Reviewer<br/>(stage 1 approval)"]
  APR["Payroll Approver / HR Admin<br/>(final approval, finalize, reopen)"]
  AUD["Auditor<br/>(read-only reports & audit)"]
  HRMS["4AT HRMS<br/>(Next.js web app + Django API)"]
  BANK["Bank<br/>(bank advice file)"]
  STAT["Statutory portals<br/>(PF / ESI / PT / TDS files)"]
  GL["Accounting<br/>(payroll journal)"]
  EMP --> HRMS
  PADM --> HRMS
  FIN --> HRMS
  APR --> HRMS
  AUD --> HRMS
  HRMS -- "CSV download" --> BANK
  HRMS -- "CSV download" --> STAT
  HRMS -- "CSV download" --> GL
```

External systems receive **files downloaded by payroll staff**; there are no outbound API
integrations in v1.

---

## 3. Containers

```mermaid
flowchart LR
  B["Browser<br/>React UI"] -- "HTTPS, HttpOnly cookies" --> N["Next.js server<br/>pages + /api/* proxy routes"]
  N -- "HTTP JSON, Authorization: Bearer JWT" --> D["Django + DRF<br/>/api/v1/*"]
  D -- "SQL (psycopg)" --> P[("PostgreSQL 16")]
  D -- "files" --> F[("Media storage<br/>documents app")]
```

| Container | Tech | Responsibility |
|---|---|---|
| Browser | React (Next.js client components), Tailwind | Payroll screens, employee My Finances; UI permission gating only |
| Next.js server | Next.js 16 route handlers | Holds auth cookies (HttpOnly), converts them to a Bearer token, refreshes on 401, forwards to Django (`frontend/src/lib/api/proxy.ts`) |
| Django API | Django 5.1, DRF, SimpleJWT | All business rules, authorization, persistence, audit |
| PostgreSQL | 16 (`backend/docker-compose.yml` for local dev, host port 5433) | System of record; row locks for finalize |
| Media storage | Local disk / object storage | Uploaded documents (documents primitive) |

The browser never sees the JWT: the proxy keeps tokens server-side, which removes a whole class
of XSS token-theft risk.

---

## 4. Components inside Django

```mermaid
flowchart TB
  subgraph payroll["payroll app"]
    direction TB
    URL["api_urls.py<br/>DRF router"]
    VW["views/<br/>config · people · processing · outputs<br/>base.PayrollViewSet"]
    SV["services/<br/>config · people · periods · runs · outputs · reports · common"]
    EN["engine/<br/>formula · breakup · calculator · statutory · money"]
    IN["integrations/<br/>attendance_source · approvals_bridge · notify"]
    MD["models.py"]
    RB["rbac.py"]
  end
  subgraph core["shared platform"]
    CS["core.scope<br/>resolve_employee_scope, user_has_permission"]
    CR["core.registry<br/>register_permissions"]
    AU["audit.service.write_audit"]
    AP["approvals<br/>Request + request_decided signal"]
    NT["notifications.notify"]
    AT["attendance · leave · org_calendar"]
    EM["employees<br/>Employee, LegalEntity"]
  end
  URL --> VW --> SV --> EN
  SV --> MD
  SV --> IN
  VW --> CS
  RB --> CR
  SV --> AU
  IN --> AP
  IN --> NT
  IN --> AT
  MD --> EM
```

### Layer contracts

| Layer | May do | Must not do |
|---|---|---|
| **views** | Authenticate, check permission codes, resolve scope, parse/validate request, call one service, shape the envelope, handle idempotency | Contain business rules or state transitions |
| **services** | Business rules, state machines, transactions and row locks, period-lock and version checks, audit writes, call engine and integrations | Know about HTTP / DRF request objects |
| **engine** | Pure calculation over plain dicts / Decimals | Touch the database, time, or globals |
| **integrations** | Adapt other modules to payroll's needs (read attendance, mirror approvals, send notifications) | Own payroll rules — they call back into services |
| **models** | Schema, constraints, simple properties | Cross-entity workflows |

Dependencies point **downwards only** (views → services → engine). The engine imports nothing
from Django, which is why it is unit-tested in isolation and reusable for previews.

---

## 5. Request lifecycle (read and write)

```mermaid
sequenceDiagram
  participant U as Browser
  participant N as Next proxy
  participant V as PayrollViewSet
  participant R as core.scope / RBAC
  participant S as Service
  participant DB as PostgreSQL
  participant A as audit
  U->>N: POST /api/payroll/periods/{id}/inputs (cookie)
  N->>V: POST /api/v1/payroll/periods/{id}/inputs/ (Bearer JWT)
  V->>R: has permission payroll.process? employee in scope?
  R-->>V: yes / 403 PAY_FORBIDDEN
  V->>S: add_input(period, data, actor)
  S->>DB: BEGIN, check period lock, version, duplicates
  S->>A: write_audit(actor, "payroll.input.created", …)
  S->>DB: COMMIT
  S-->>V: domain object
  V-->>N: {"success": true, "data": …}
  N-->>U: same envelope (+ rotated cookies if refreshed)
```

Cross-cutting behaviour applied on this path:

| Concern | Where | How |
|---|---|---|
| Authentication | Django `JWTAuthentication`; Next proxy | Bearer token from HttpOnly cookie; transparent refresh on 401 |
| Authorization | `views/base.py::PayrollPermission` | `required_permission` / `action_permissions` / `any_permissions` per action (codes from `rbac.py`) |
| Data scope | `PayrollViewSet.scope_ids`, `employee_in_scope` | `resolve_employee_scope(user, code)` → self / team / all |
| Errors | `services/common.py`, `PayrollViewSet.handle_exception` | Uniform `{"success": false, "error": {code: "PAY_*", message, details}}` |
| Idempotency | `PayrollViewSet.idempotent` + `IdempotencyRecord` | Same `Idempotency-Key` + scope replays the stored response |
| Concurrency | `TrackedModel.version`, `select_for_update` | Optimistic `PAY_VERSION_CONFLICT`; row locks when finalizing |
| Period lock | `services/common.py::ensure_unlocked` | Any write on a finalized period → `409 PAY_PERIOD_LOCKED` |
| Audit | `audit.service.write_audit` | Append-only log entry with actor, entity, before/after for every mutation |
| Transactions | `@transaction.atomic` on every mutating service | All-or-nothing, e.g. finalize locks every result or none |

---

## 6. Calculation architecture

```mermaid
flowchart LR
  subgraph gather["services/runs.calculate (DB side)"]
    P["Period + PayGroup"] --> C
    POP["Population<br/>(eligible employees)"] --> C
    CMP["Compensation versions<br/>+ frozen structure lines"] --> C
    ATT["Attendance summary<br/>(integration or import)"] --> C
    INP["Approved inputs<br/>+ overrides"] --> C
    RUL["Effective statutory rules"] --> C
    C["Build ctx per employee<br/>(plain dicts, Decimals)"]
  end
  C --> E["engine.calculate_employee(ctx)<br/>pure, deterministic"]
  E --> R["Result: lines + trace + exceptions"]
  R --> V["Validations, holds, variance<br/>vs previous finalized result"]
  V --> ST[("Store: PayrollRun n,<br/>InputSnapshot, results,<br/>components, exceptions")]
```

- **Gather once, calculate purely.** The service reads everything a run needs, freezes it into an
  `InputSnapshot`, then calls the engine per employee with plain data. The engine never queries.
- **Deterministic:** `ENGINE_VERSION` is stored on each run; same context ⇒ same output, so a run
  can be re-explained or re-computed for audit.
- **Append-only runs:** a recalculation writes run *n+1* and supersedes the previous draft; a
  finalized run is immutable.
- **Trace:** every component line stores source, rule/structure version, formula, inputs and the
  rounded value — the trace screen reads it; nothing is recomputed on display.
- **Extensibility:** new statutory rules are data (`StatutoryRule` params); new formula variables
  are added in `engine/formula.py` context building; the attendance source is swappable
  (`attendance.payroll_provider` if present, else `payroll.integrations.attendance_source`, else
  manual import).

---

## 7. Workflow & state architecture

```mermaid
stateDiagram-v2
  direction LR
  state Period {
    draft --> in_progress
    in_progress --> pending_approval: run submitted
    pending_approval --> approved
    approved --> finalized: LOCK
    finalized --> reopened: privileged reopen
    reopened --> in_progress
    finalized --> completed: outputs done
  }
```

```mermaid
stateDiagram-v2
  direction LR
  [*] --> ready: calculate
  ready --> submitted: submit
  submitted --> returned: finance returns / rejects
  submitted --> approved: final approval
  approved --> finalized: finalize
  finalized --> reopened: reopen
  ready --> superseded: recalculated
  returned --> superseded: recalculated
  reopened --> superseded: recalculated
```

- State transitions live **only** in `services/runs.py` and `services/people.py`; each checks the
  current state and raises `PAY_INVALID_STATE` otherwise.
- Maker-checker is structural: submit (`payroll.process`), Finance Review (`payroll.review`),
  Final Approval (`payroll.approve`), finalize (`payroll.finalize`) and reopen (`payroll.reopen`)
  are separate permissions, and the preparer is always excluded from approving.

### Integration with the shared approvals inbox

Payroll is multi-stage; the shared engine is single-approver. The bridge
(`integrations/approvals_bridge.py`) **mirrors** each pending payroll stage as one
`approvals.Request`:

```mermaid
flowchart LR
  subgraph payrollSide["Payroll (source of truth)"]
    S1["Stage opens"] --> OS["open_stage → Request(approver)"]
    DP["Decided on payroll screen"] --> CL["close_stage → resolve Request"]
  end
  subgraph inbox["Shared Approvals inbox"]
    RQ["Request pending"] --> DC["Decided in inbox"]
  end
  OS --> RQ
  DC -- "request_decided signal" --> AP["runs.decide / people.decide_revision<br/>(from_inbox=True)"]
  AP -- "PayrollError" --> RB["Reset Request to pending,<br/>return 'Payroll: …' error"]
  CL --> RQ
```

Payroll remains the source of truth: an inbox decision is applied **through payroll's own
service**, so maker-checker, permissions and audit still apply; if payroll refuses, the inbox
request is rolled back so both sides agree.

---

## 8. Data architecture

| Group | Tables | Notes |
|---|---|---|
| Configuration | `PayGroup`, `SalaryComponent` (+`Version`), `SalaryStructure` (+`Component`, `Version`), `StatutoryRule` | Effective-dated, versioned; `TrackedModel` gives `version` + created/updated by/at |
| People | `EmployeePayrollProfile`, `CompensationRevision`, `EmployeeCompensation`, payment/statutory info, loans | Compensation versions never overlap; revision approval closes the prior version |
| Processing | `PayrollPeriod`, `AttendancePayrollInput`, `PayrollInput`, `PayrollEmployeeAction`, `PayrollOverride` | All writes blocked when the period is locked |
| Results | `PayrollRun`, `InputSnapshot`, `EmployeePayrollResult`, `PayrollResultComponent`, `PayrollException`, `PayrollApproval` | Append-only per run; one current run per period |
| Outputs | `Payslip`, `PayrollOutput` | Versioned; regeneration supersedes |
| Infrastructure | `IdempotencyRecord` | Stored responses for retried POSTs |

Ownership boundaries: payroll **reads** `employees.Employee`, attendance, leave and calendar data
but never writes them; other modules never write payroll tables. Money columns are `Decimal`
(`max_digits` sized for INR), never floats.

---

## 9. Security architecture

```mermaid
flowchart TB
  RQ["Request"] --> AN{"Authenticated?"}
  AN -- no --> X401["401"]
  AN -- yes --> PM{"Has permission code<br/>for this action?"}
  PM -- no --> X403["403 PAY_FORBIDDEN"]
  PM -- yes --> SC{"Employee in caller's scope?<br/>(self / team / all)"}
  SC -- no --> X403
  SC -- yes --> ST{"Extra rule?<br/>own slip must be released,<br/>preparer ≠ approver,<br/>sensitive fields masked"}
  ST -- fails --> X403
  ST -- ok --> OK["Service call"]
```

- **Defence in depth:** UI hides what a user can't do, but every rule is enforced server-side;
  tests call endpoints directly as each role (`test_rbac_matrix.py`).
- **Self-service isolation:** `/my/*` endpoints derive the employee from the token, never from
  the URL, and filter `employee = me AND status = released` in one query.
- **Sensitive data:** bank / PAN / UAN masked unless `payroll.sensitive.read`; payslips show
  last 4 digits only; employer-cost lines never appear on employee payslips.
- **Documents:** permission grants for employee-owned files are scope-checked (fixes a
  cross-employee payslip-document read found during UAT).
- **Audit:** every mutation (including report exports and output downloads) is logged; reopen
  requires a reason, which is stored.
- **No dynamic code:** formulas are parsed by a whitelist AST evaluator — never `eval`.

---

## 10. Frontend architecture

```mermaid
flowchart LR
  PG["app/(app)/payroll/** pages"] --> CMP["components/payroll/**<br/>ui kit · run wizard steps · PayslipView"]
  PG --> MET["lib/payroll/meta.ts<br/>usePayrollMeta(): choices + my permissions"]
  CMP --> API["lib/payroll/api.ts<br/>payrollApi.get/post/put…"]
  MET --> API
  API --> RT["app/api/payroll/[...path]/route.ts<br/>createBackendProxyRoute('payroll')"]
  RT --> DJ["Django /api/v1/payroll/*"]
  ESS["app/(app)/payslips (My Finances)"] --> API
  ESS --> DOC["components/payroll/payslipDocument.ts<br/>printable payslip (PDF)"]
```

- Screens follow the UI Design Reference 1:1 and use only the payroll UI kit (no reuse of older
  payroll screens).
- `usePayrollMeta()` fetches choice lists and the caller's permission codes once (cached) for
  gating buttons; the sidebar's Payroll entry needs one of the staff permissions.
- The run wizard is URL-driven (`/payroll/run/<periodId>?step=…`) so every step is linkable and
  reload-safe; read-only mode is derived from permissions + period lock.
- The proxy adds a trailing slash for DRF routers (payroll) and omits it for routers built
  without (`attendance`, `leave`, `calendar`, `requests`).

---

## 11. Deployment view

| Environment | Composition |
|---|---|
| Local dev | `next dev` (port 3001) → `manage.py runserver` (8000) → Postgres 16 on 5433 (local install or `backend/docker-compose.yml`); SQLite fallback when `POSTGRES_HOST` is unset |
| Tests | `pytest --ds=config.settings.test` against Postgres (`hrms` database) |
| Production (planned) | Next.js server + Django + managed Postgres; secrets from environment, never in the repo. Note: `backend/Dockerfile` currently starts `manage.py runserver` — switch to a WSGI server (e.g. gunicorn) before go-live |

Everything is synchronous in-request: a monthly run for the current headcount calculates in
seconds. If headcount grows enough that calculation exceeds request time limits, the calculate
service is already isolated behind one function and can be moved to a background worker without
changing the engine or the API contract (return the run in `calculating` state and poll).

---

## 12. Key architecture decisions

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| AD-1 | Modular monolith app inside the existing Django project | Separate payroll service | Shares auth, RBAC, audit and DB transactions; far less operational cost |
| AD-2 | Pure calculation engine over plain data | ORM-driven calculation | Determinism, reproducibility, DB-free unit tests, preview reuse |
| AD-3 | Decimal-only money with configured rounding points | Floats, round at end | Avoids paisa drift; matches Calculation Rules §9 |
| AD-4 | Versioned config + append-only runs + superseded outputs | Update in place | Past payroll must stay explainable; audit and compliance |
| AD-5 | Separate permission per approval stage | Single "payroll admin" role | Maker-checker enforced by construction |
| AD-6 | Mirror stages into shared approvals inbox | Replace with engine / separate inbox | Keeps payroll's multi-stage rules while approvers use one inbox |
| AD-7 | Statutory values as effective-dated data | Hard-coded rates | Laws and state slabs change; no deploy needed |
| AD-8 | Unmarked attendance = pending, not absent | Treat as LOP | Never silently cut pay |
| AD-9 | Next.js proxy holds tokens in HttpOnly cookies | Tokens in browser storage | XSS cannot steal tokens |
| AD-10 | Copy (not merge) features from in-progress branches | Merge branches | Keeps teammates' work unaffected until the planned merge to main |
| AD-11 | Payslip PDF rendered client-side from the scope-checked API payload | Server PDF library | No new dependency and no second data path to secure; server PDF can be added for emailing later |

---

## 13. Known architectural limits

- Calculation is synchronous (fine for current headcount — see §11 for the scale-out path).
- No outbound integrations (bank / statutory / accounting are file downloads).
- Payroll keeps its own payment-info tables until the organization branch's `BankDetails` /
  `IdentityDocument` are merged and can be adopted.
- One role per user in the platform RBAC: payroll-only roles lack employee self-service.
- Mermaid diagrams in the HTML load from a CDN; offline, the diagram source text is shown.
