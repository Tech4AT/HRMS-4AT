# 4AT-HRMS

Internal HR system for a single company (one deployment, no multi-tenancy, 4 fixed
roles). The existing Node/NestJS backend has been discarded; a new Django + DRF
backend is being built from scratch against the existing Next.js frontend, which stays
unchanged.

```text
4AT-HRMS/
├── docs/       ← you are here
├── frontend/   ← existing Next.js app, moved as-is
└── backend/    ← Django + DRF backend (implemented on the RBAC branch —
                see IMPLEMENTATION-STATUS.md for what is built)
```

## Documentation map

| Doc | What's in it |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | Who uses the system (roles), what each module does, the non-negotiable security baseline |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The seven core primitives, how modules build on them, the request/approval flows, tech stack |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Phases, timeline, the 4-engineer parallelization strategy, the exact API contract Django must match |
| [TASKS.md](TASKS.md) | The concrete, ordered task breakdown (task IDs, owners, dependencies) engineers execute against |
| [DEVELOPMENT.md](DEVELOPMENT.md) | How to run the frontend and (once it exists) the backend locally |

Read them in that order the first time. `REQUIREMENTS.md` and `ARCHITECTURE.md` are the
*what/why* (source of truth for scope); `IMPLEMENTATION-PLAN.md` and `TASKS.md` are the
*how/when* (execution).

## Source documents

These docs were distilled from three planning documents produced during the rebuild
decision:

1. **HRMS — Architecture PRD v1** — the requirements and architecture source of truth.
2. **HRMS — Implementation Plan** — the Django/DRF execution plan against that PRD.
3. **`tasks.md`** — the granular task breakdown against the Implementation Plan, refined
   further against a separate gap-analysis document (PASA) not reproduced here.

Each later document explicitly builds on the one before it, and each one *refines* the
prior rather than always matching it exactly. The differences that matter are called out
below so they don't get silently picked up as ambiguity later.

## Known conflicts across the source documents (and how they're resolved here)

- **Backend framework — the PRD contradicts itself.** The Architecture PRD's own tech
  stack section (§5) has an architecture diagram that shows *"Backend platform — Django,
  one deployable"* with *"Django ORM + migrations — schema defined in code, no raw
  SQL,"* but the table directly below it in the same section says **NestJS** (or any
  structured Node/TS backend) with **raw `pg` + `node-pg-migrate`, no ORM**. The
  Implementation Plan resolves this by going with Django + DRF + the Django ORM (the
  diagram's choice, not the table's) — that's what `TASKS.md` is written against, and
  it's the resolved direction for `backend/`.

- **Recruitment/ATS is in scope in two documents, explicitly cut in the third.** The PRD
  lists *Recruitment/Onboarding* as a real module with a candidate pipeline, and the
  Implementation Plan assigns it to an engineer (candidate pipeline → sets
  `Employee.status = active` on hire). `tasks.md` removes it entirely: *"candidates
  aren't employees or users... a separate product surface with its own auth model,"*
  and redirects that capacity to **Exit/Offboarding** instead (validated as the actually-
  missing gap: today there's only a hard `DELETE` on exit, no resignation workflow,
  notice period, checklist, or settlement). **Resolution: Recruitment/ATS is out of
  scope for this build; Offboarding replaces it.** The one hire-side touchpoint that
  survives is setting `Employee.status = active` on hire — a small hook, not a pipeline.

- **Permission code notation — colon vs. dot.** The Implementation Plan's contract
  examples use colon-notation (`attendance:read:self`). `tasks.md` explicitly overrides
  this: dot-notation (`attendance.read.self`, `leave.approve`, `scope.all`) to match
  convention used elsewhere. **Resolution: dot-notation**, per `tasks.md`.

- **A "Community" module appears with no PRD counterpart.** The PRD's module table
  (§2) has no module matching `Post`/`Poll`/`Praise`/`Announcement` — that content
  exists in the frontend today as the "Engage" feed. The Implementation Plan and
  `tasks.md` both add a `community` app for it. This is an *addition* on top of the PRD's
  module list (to match already-built frontend surface), not a contradiction — noted
  here so it isn't mistaken for a PRD module that got renamed.

- **Still genuinely open** (flagged as open in both the PRD and the Implementation Plan,
  not yet resolved by any document): a 5th "IT/System Admin" role, SSO vs. password
  auth (depends on whether the company runs Google Workspace/M365), leave
  carry-forward policy, and the payroll proration formula. These are business decisions
  for the stakeholder, not engineering calls — see the Open Questions sections in
  [REQUIREMENTS.md](REQUIREMENTS.md) and [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## Status

- ✅ Frontend moved into `frontend/`, unchanged, confirmed to have no absolute-path or
  repo-location dependencies.
- ✅ Documentation consolidated into `docs/`.
- ✅ `backend/` implemented on the RBAC branch — RBAC core, approvals,
  audit, notifications, employees, payroll, documents, example_leave (see
  [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md); the original
  [TASKS.md](TASKS.md) Phase 0 plan is history).
