# Module integration tests (human-readable acceptance)

One section per orchestrated task. Written before hand-off so the worker and
tester aim at a fixed target.

---

## [P01] Integrate the payroll module into the core

**Goal:** the `backend/payroll` app (from `origin/payroll_module`, built on the old
baseline) is reworked to plug into the core per `backend/MODULE-GUIDE.md`, so payroll
data is RBAC-scoped like every other module and it passes its own live verification.

**Manual check (for the human):**
1. As an **Employee**, `GET` the payroll list endpoints → they see **only their own**
   payroll records (never a colleague's salary).
2. As a **Manager**, the same endpoints → they see **their team's** records, not the
   whole company.
3. As **HR/Finance (scope: all)** → they see everyone.
4. There is **one** `LegalEntity` concept (the core's `employees.LegalEntity`), not a
   duplicate payroll one.
5. Payroll permission codes appear in the RBAC registry (Access Control screen), not a
   hard-coded `IsPayrollFinance` bypass.

**Automated check:** `python manage.py verify_payroll` — expect exit 0 and a green
`backend/verification-reports/verify_payroll-<timestamp>.html`. Also:
`python manage.py check` clean, migrations apply, and `pytest backend/payroll/tests/`
(a conformance test via `core.testing.assert_module_conforms`) passes.

**Status:** ☑ merged — verify_payroll 25/25, conformance 2/2 (done directly by god after worker pipeline failed on token economics)

## [APP-3] Approvals inbox (frontend)

**Goal:** Give approvers and requesters a UI for the approvals engine — see requests to act on, approve/reject with a note, see your own requests and withdraw them.

**Manual check (for the human):**
1. As a manager with a pending request routed to you, open Approvals → "To approve". The request shows requester, type, payload summary, date. Click Approve (add a note) → row moves to resolved, requester gets a bell notification.
2. Click Reject on another → same, status shows rejected with the note.
3. As the requester, open "My requests" → see your raised requests with status; Withdraw a pending one → status becomes withdrawn.
4. A user with no requests and none to approve sees empty states, not an error.

**Automated check:** frontend typecheck + lint clean (`npx tsc --noEmit`, the repo's eslint). Backend already tested (approvals/tests). Worker adds the `/api/requests` proxy route and confirms it reaches `api/v1/requests`.

**Status:** ☑ merged (604eb84) — tester PASS

## [T06] Forced password change on first login (admin-set temp password model)

Decision (2026-09-24): admin issues a temporary password; employee is forced to
change it on first login. Email invites and SSO are out of scope for T06.

Acceptance:
1. `User.must_change_password` (Boolean, default False) exists + migration applied.
2. Admin `POST users/{id}/reset-password` sets `must_change_password=True`.
3. Login response and `GET users/me` include `mustChangePassword` (camelCase).
4. `POST users/me/change-password` sets `must_change_password=False` on success.
5. A user with `must_change_password=True` who calls change-password successfully
   ends with the flag cleared and a working new password.
6. Frontend: when `mustChangePassword` is true after login, the user is routed to
   the change-password screen and cannot reach the app until they change it.
7. New backend tests cover 2/3/4/5; existing accounts/verify_rbac tests still pass.

## [T07] Bulk-provision logins for real employees (no send)

Depends on T06 (done). Gives employees who currently have an unusable password
a temporary one they must change on first login. Distribution of credentials is
the human's job — this command only creates them and writes an export file.

Acceptance:
1. New management command `provision_logins` in backend/accounts/management/commands/.
2. For each active User linked to an employee whose password is unusable
   (`has_usable_password()` is False): set a random temp password
   (secrets.token_urlsafe) and `must_change_password=True`.
3. Idempotent: users who already have a usable password are skipped unless
   `--force` is passed (then reset + flag them too).
4. `--dry-run` reports counts and changes nothing.
5. Writes an export CSV (path via `--out`, default under a gitignored dir) with
   columns email,temporary_password — and prints the count. NEVER commit the CSV.
6. Writes one audit row per provisioned user (write_audit, action
   "User.login_provisioned").
7. Does NOT send email or any external message.
8. A test covers: unusable-password user gets provisioned + flagged; usable-password
   user is skipped without --force; --dry-run changes nothing.
