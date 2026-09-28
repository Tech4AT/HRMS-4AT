# Multi-Role RBAC — Test Specification (tests.md)

The feature: a user may hold **zero, one, or many roles** instead of exactly one.
This document is the **contract**. The implementation must satisfy every case
here; the tester validates against it after development. No behaviour is left
undefined — that is the point of this file.

Real DB (146 employees) preserved; additive migration; author Nandini Velamuri.

---

## 0. The resolution contract (what "effective access" means with many roles)

For a `(user, permission_code)`:

1. **Override wins, always.** If a `UserPermissionOverride` exists for that
   `(user, code)`: it decides. `is_granted=False` → **denied outright** (no
   access), regardless of how many roles grant it or of the baseline.
   `is_granted=True` → granted at **the override's own `scope_tier`**, even if a
   role would give a broader *or* narrower tier. Exactly one override per
   `(user, permission)` (unique constraint).
2. **Else union across the user's ACTIVE roles.** If any active role grants the
   code, the effective tier is the **broadest** tier among them, by the order
   `SELF < MANAGER < TEAM < DEPARTMENT < LOCATION < LEGAL_ENTITY < ALL`.
   Inactive roles (`is_active=False`) contribute nothing.
3. **Else the self-service baseline.** If no override and no active role grants
   the code, and the code is a baseline self-service code and the user **has an
   employee record**, it is granted at **SELF**. Otherwise denied.
4. A user with **no roles** has only the baseline (if an employee) plus overrides.

`user_effective_permissions(user)` = (union of all active roles' codes) ∪ (override
grants) ∪ (baseline codes if employee) − (override denies).

**Tier union rule (the only new logic):** broadest active-role tier wins.
Ties and duplicates are idempotent. The override layer and the baseline layer are
**unchanged** from single-role — only the role layer becomes a union.

### Primary role / archetype (frontend still needs one)
The frontend renders one archetype per user. Define a deterministic **primary
archetype** = the most-privileged archetype among the user's active roles by the
order `superadmin > admin > finance > manager > employee`. Zero roles → `employee`
if the user has an employee record, else the account's own archetype default.
`/users/me` returns `roles: [...]`, the flat effective `permissions`, and this
single `archetype`.

### Data model
`User.roles` = ManyToMany(Role) (replaces the `role` FK). Migration converts each
existing user's single role into one M2M membership — **no access changes for
anyone on day one**. Role delete stays blocked while any user holds it (existing
guard). `RolePermission` (role×permission×tier) is unchanged.

---

## A. Resolver unit tests (`core/tests/test_scope.py`, Postgres)

| # | Scenario | Setup | Expected |
|---|---|---|---|
| A1 | Single role (regression) | user with role R granting `employees.read`@TEAM | `user_has_permission`=True; tier TEAM; identical to pre-feature |
| A2 | No roles, employee | user, no roles, has employee record | only baseline codes granted @SELF; non-baseline denied |
| A3 | No roles, non-employee | user, no roles, no employee record | everything denied; baseline does NOT apply |
| A4 | Two roles, same code, different tiers | R1 `employees.read`@TEAM, R2 `employees.read`@DEPARTMENT | effective tier = DEPARTMENT (broadest) |
| A5 | Two roles, same code, one ALL | R1 @MANAGER, R2 @ALL | effective tier = ALL |
| A6 | Two roles, disjoint codes | R1 grants `payroll.read`@ALL, R2 grants `org.manage`@ALL | user holds both, each at its tier |
| A7 | Broadest-tie | R1 @DEPARTMENT, R2 @DEPARTMENT | DEPARTMENT; no double effect |
| A8 | Duplicate role membership | same role added twice (or idempotent add) | identical to holding it once |
| A9 | One active, one inactive role | R1(active) `employees.read`@TEAM, R2(inactive) @ALL | effective TEAM (inactive ignored) |
| A10 | All roles inactive | user holds only inactive roles | falls to baseline/deny as if no roles |
| A11 | SELF vs broader | R1 `ess.profile.read`@SELF, R2 same @ALL | ALL wins (broadest) |
| A12 | Narrowest only | R1 grants `audit.read`@SELF only | SELF |

## B. Override layer over many roles (`test_scope.py`)

| # | Scenario | Setup | Expected |
|---|---|---|---|
| B1 | Deny beats every role | 2 roles grant `payroll.read`@ALL; override deny `payroll.read` | denied (403); not in effective set |
| B2 | Deny beats baseline | employee (baseline `ess.profile.read`); override deny it | denied |
| B3 | Grant adds a code no role has | no role grants `org.manage`; override grant @DEPARTMENT | granted @DEPARTMENT |
| B4 | Grant narrower than roles | roles give `employees.read`@ALL; override grant @TEAM | effective TEAM (override wins even though narrower) |
| B5 | Grant broader than roles | roles give @TEAM; override grant @ALL | ALL |
| B6 | Override source label | any override | `explain_permission` source = "override" / "override (deny)" |

## C. Scope queryset (`resolve_employee_scope`, `test_scope.py`)

| # | Scenario | Expected |
|---|---|---|
| C1 | Two roles TEAM+DEPARTMENT on `employees.read` | queryset = DEPARTMENT scope of the caller (broadest) |
| C2 | Any role at ALL | `Employee.objects.all()` (even if caller has no employee record) |
| C3 | No grant | `Employee.objects.none()` |
| C4 | `resolve_management_scope` with two roles | returns the broadest of self/team/org consistent with the union tier |

## D. Effective-set + /users/me (`accounts/tests/test_auth.py`, `test_admin_panel_api.py`)

| # | Scenario | Expected |
|---|---|---|
| D1 | Two roles union | `user_effective_permissions` = union of both roles' codes (+baseline −denies) |
| D2 | `/users/me` shape | returns `roles: [names]`, flat `permissions`, single `archetype`, `scope` |
| D3 | Archetype precedence | user with manager+admin roles → archetype "admin" |
| D4 | Zero roles employee | `/users/me` archetype "employee"; permissions = baseline set |
| D5 | Preview/explain per code | admin panel preview matches the contract for a multi-role user |

## E. Role assignment API — user side (`test_admin_panel_api.py`)

| # | Scenario | Expected |
|---|---|---|
| E1 | Assign multiple roles to a user | PATCH user with `role_ids=[r1,r2]` → user holds both; gated by `roles.manage` |
| E2 | Remove a role | PATCH removing r2 → only r1 remains; effective perms shrink accordingly |
| E3 | Assign zero roles | user ends with no roles; baseline-only |
| E4 | Non-admin forbidden | caller without `roles.manage` → 403 |
| E5 | Assign inactive role | either rejected with a clear error, or accepted but contributes nothing (pick one; test pins it) |
| E6 | Self-lockout guard | an admin cannot remove their own last `roles.manage`-bearing role (same spirit as "can't change own role") |

## F. Role assignment API — role side (`test_admin_panel_api.py`)

| # | Scenario | Expected |
|---|---|---|
| F1 | Add users to a role | POST role `add_users=[u1,u2]` → both gain the role (membership), others untouched |
| F2 | Remove users from a role | removing u1 → u1 loses only that role, keeps others |
| F3 | Role card user count | `Role.user_count` / users list reflects current membership after F1/F2 |
| F4 | Delete role with members | blocked with the existing "move them first" error |

## G. Migration & data preservation (`accounts/tests/test_migrations*.py` or a data test)

| # | Scenario | Expected |
|---|---|---|
| G1 | Forward migration | every user's old single `role` becomes exactly one M2M membership |
| G2 | No access drift | for every existing user, `user_effective_permissions` is identical before and after the migration |
| G3 | Null role user | a user with `role=None` migrates to zero memberships |
| G4 | 146-employee DB intact | employee count unchanged; login still 200 |

## H. Regression — single-role parity (whole suite)

| # | Scenario | Expected |
|---|---|---|
| H1 | Every existing RBAC test | passes unchanged with one-role users (single membership behaves exactly as the old FK) |
| H2 | Conformance harness | `payroll`/`example_leave` conformance + `verify_rbac` still green (permission-less caller = non-employee, per the baseline fix) |
| H3 | Full backend suite on Postgres | green except the 3 pre-existing `documents` ACL failures (DOC-ACL-GAP), which are unrelated |

## I. Frontend / end-to-end (tester validates in the running app)

| # | Scenario | Expected |
|---|---|---|
| I1 | Users tab → change roles | multi-select shows all active roles; can tick several; save persists |
| I2 | Role card → Add users | "Add users" opens a people multi-select; assigning updates the card's user chips |
| I3 | Permission count | a multi-role user's count = the true union (matches backend) |
| I4 | Manage exceptions still works | per-user override add/deny still applies on top and wins |
| I5 | No console errors, tsc clean | `npx tsc --noEmit` clean; no runtime errors on /admin |

---

## Definition of done
- All A–H automated tests written and **green on Postgres** (not SQLite), plus the
  full suite green except the known DOC-ACL-GAP trio.
- I1–I5 validated by the tester in the rebuilt app.
- Migration proven access-neutral (G2) on the real 146-employee DB.
- No undefined behaviour: every row above has a single expected outcome.
