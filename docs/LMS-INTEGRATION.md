# LMS Integration (HRMS side)

Source: *4AT HRMS — LMS Integration PRD v1.0*, *API & Event Contract v1.0*,
*Data Mapping & Integration Design v1.0*, *Implementation Plan & UAT v1.0*.

HRMS owns employee identity, employment and organisation. The LMS
(`LMS-Backend`, Spring Boot microservices + `4AT-LMS-Frontend`, Angular) owns
courses, learning paths, assessments, certifications and skills. Neither
system edits the other's data except through the contract below.

Code: `backend/lms_integration/`.

```
 HRMS                                   Integration                          LMS
 Employee save / exit / onboarding --> outbox (IntegrationEvent) --lms_dispatch--> POST /integrations/hrms/events
                                                                                   (upsert learner, return learner_id)
 Learning tab / dashboards  <-- projections <-- POST /api/v1/integrations/lms/events <-- LMS outbox (completion, cert, skill)
 "Open LMS" button  --> POST sso/launch (60 s token) --> browser POSTs token --> LMS /auth/hrms-sso --> LMS session
```

## Configuration

| Setting | Meaning |
|---|---|
| `LMS_INTEGRATION_ENABLED` | Queue outbound events on employee changes. Off by default; nothing is queued while off, and a later `lms_reconcile --provision` provisions anyone missed. |
| `LMS_BASE_URL` | LMS integration base, e.g. `https://lms.example.com/employee` (gateway route to employee-services). Blank = events stay queued. |
| `LMS_OUTBOUND_SECRET` | HMAC secret HRMS signs outbound calls with (LMS verifies). |
| `LMS_INBOUND_SECRET` | HMAC secret the LMS signs its webhooks with (HRMS verifies). |
| `LMS_SSO_SECRET`, `LMS_SSO_LAUNCH_URL`, `LMS_SSO_TOKEN_TTL_SECONDS` | SSO hand-off (below). |
| `LMS_TIMEOUT_SECONDS`, `LMS_MAX_ATTEMPTS` | HTTP timeout; attempts before an event is FAILED. |

Jobs (cron):

```
python manage.py lms_dispatch            # every minute (or: lms_dispatch --loop 15)
python manage.py lms_reconcile           # nightly; add --provision to queue the safe fixes
```

## Identity

- `employee_id` sent to the LMS is the HRMS `Employee.pk` (never changes). The
  LMS stores it as `external_employee_id`.
- `LmsIdentityLink` holds the LMS `learner_id` once the LMS confirms it.
  `learner_id` is unique: one learner can never be linked to two employees.
  A clash becomes `status=conflict` and is shown in reconciliation; it is never
  resolved automatically (Data Mapping §4).
- Provisioned statuses: `active`, `on_leave`. `pre_onboarding` hires are
  provisioned when they become active; exits send `EMPLOYEE_STATUS_CHANGED`
  with `employment_status: EXITED`, and the link becomes `deactivated` once the
  LMS acknowledges. A rehire reuses the same learner.

## Outbound events (HRMS → LMS)

Raised automatically from `Employee` / `OnboardingProfile` saves
(`lms_integration/signals.py`), written to the outbox in the same transaction
as the HR change, delivered later by `lms_dispatch`. Failures never fail the
HR transaction (UAT-11).

| Event | When |
|---|---|
| `EMPLOYEE_CREATED` | employee first becomes active (or rehired) |
| `EMPLOYEE_UPDATED` | code, name, work email, department, manager, location, joining date change |
| `EMPLOYEE_STATUS_CHANGED` | status changes (incl. exit) |
| `ROLE_CHANGED` | designation, grade, level or position changes |
| `ONBOARDING_STAGE_CHANGED` | onboarding stage changes (for provisioned employees) |

Every event carries the **full current snapshot**, so the LMS just applies the
newest one:

```json
{
  "event_id": "evt_…", "event_type": "EMPLOYEE_CREATED", "schema_version": "1.0",
  "occurred_at": "2026-09-28T10:00:00+00:00", "correlation_id": "corr_…", "source": "hrms",
  "learner_id": null,
  "employee": {
    "employee_id": "42", "employee_code": "4AT001", "name": "…", "email": "…",
    "employment_status": "ACTIVE", "employment_type": "FULL_TIME",
    "department_id": "3", "department_name": "Engineering",
    "designation_id": "7", "designation_name": "Backend Engineer", "grade_id": null,
    "manager_employee_id": "10", "manager_email": "…",
    "location_id": "2", "location_name": "Hyderabad",
    "date_of_joining": "2026-09-01", "date_of_exit": null
  },
  "onboarding": {"stage": "onboarding"}
}
```

No personal data (phone, DOB, bank, ID documents) is ever sent.

Delivery: `POST {LMS_BASE_URL}/integrations/hrms/events`, headers
`Idempotency-Key: <event_id>`, `X-Correlation-Id`, and the signature below.
The LMS answers `2xx {"learner_id": "…"}`; `409` means "already applied" and
counts as success. 5xx / 408 / 429 / network errors retry with exponential
backoff (30 s doubling, max 6 h) up to `LMS_MAX_ATTEMPTS`, then FAILED. Other
4xx fail immediately (configuration problem). Events for one employee are
delivered strictly in order.

## Inbound events (LMS → HRMS)

`POST /api/v1/integrations/lms/events`, signed, idempotent by `event_id`
(a repeat of an applied event is acknowledged, a repeat of a FAILED one is
re-applied). Projections keep the `occurred_at` they reflect and ignore older
events.

```json
{"event_id": "evt_…", "event_type": "COURSE_COMPLETED", "schema_version": "1.0",
 "occurred_at": "…", "correlation_id": "…", "source": "lms",
 "employee_id": "42", "learner_id": "9001", "data": {…}}
```

| event_type | `data` |
|---|---|
| `LEARNER_LINKED` | — (uses top-level `learner_id`) |
| `LEARNING_ENROLLED` | `course_id`*, `title`, `category`, `path_id`, `path_name`, `mandatory`, `assigned_at`, `due_at`, `progress`, `status` |
| `LEARNING_PROGRESS` | `course_id`*, `progress`* (0–100) |
| `COURSE_COMPLETED` | `course_id`*, `completed_at`, `score`, `title` |
| `ASSESSMENT_COMPLETED` | `assessment_id`*, `title`, `course_id`, `status`, `score`, `max_score`, `completed_at` |
| `CERTIFICATION_EARNED` / `_EXPIRING` / `_EXPIRED` | `certification_id`*, `name` (* first time), `issued_at`, `expires_at`, `credential_url` |
| `SKILL_UPDATED` | `skill_id`*, `name`*, `proficiency`, `proficiency_score`, `evidence_refs[]` |

Responses: `200` applied / duplicate, `401` bad signature, `400` malformed,
`409` link conflict, `422` validation or unknown employee (stored as FAILED,
visible in Sync Health).

## Signing (both directions)

```
X-Signature-Timestamp: <unix seconds>
X-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```

Rejected if the timestamp is more than 300 s off. Reference implementation:
`lms_integration/client.py::sign/verify`.

## SSO

`POST /api/v1/integrations/lms/sso/launch {"target": "/student/courses"}`
returns `{launch_url, method: "POST", field: "token", token, expires_at}`.
The browser form-POSTs `token` to `launch_url`. The token is an HS256 JWT
(`LMS_SSO_SECRET`): `iss=4at-hrms`, `aud=4at-lms`, `sub=<employee_id>`, `jti`,
`exp` (60 s), `employee_code`, `email`, `name`, `learner_id`, optional
`target` (relative LMS path only). Exited employees cannot launch.

## HRMS API (`/api/v1/integrations/lms/…`)

| Method | Path | Permission |
|---|---|---|
| GET | `learners/{id or me}/summary` · `/courses` · `/assessments` · `/certifications` · `/skills` | `lms.read` (scope-checked) |
| GET | `enrollments/`, `certifications/` (team/org lists, `?employee=`) | `lms.read` (scoped) |
| GET | `compliance` | `lms.read` (over caller's scope) |
| POST | `sso/launch` | `lms.launch` (self) |
| GET/POST | `learners` (list links / link or provision) | `lms.admin` |
| PATCH | `learners/{id}` (re-sync) · POST `learners/{id}/reset-link` | `lms.admin` |
| GET | `sync-jobs`, `sync-jobs/{id or event_id}` · POST `sync-jobs/{id}/retry` | `lms.admin` |
| GET | `health` | `lms.admin` |
| GET/POST | `reconcile`, GET `reconcile/{run}` | `lms.admin` |
| POST | `events` | LMS (HMAC) |

Default grants: `lms.read` Employee=self, Manager=manager, HR Admin/Auditor=all;
`lms.launch` everyone (self); `lms.admin` HR Admin.

## Changes required in the LMS

None of these are made yet — they need sign-off since they touch the LMS repo.

1. **Learner identity** (`lmsng-models` `LmsUser` + a Liquibase changeset under
   `lmsng-employee-services/.../db/changelog/feature/`): add
   `external_employee_id VARCHAR(64) UNIQUE NULL` and `employee_code`.
2. **Inbound endpoint** in `lmsng-employee-services`, routed by the gateway's
   `/employee/**`: `POST /employee/integrations/hrms/events` and
   `GET /employee/integrations/hrms/learners?page&size`
   (`{items:[{learner_id, employee_id, status, email}], has_more}`).
   The gateway JWT filter must skip `/employee/integrations/hrms/**`; an HMAC
   filter verifies `X-Signature` instead. An `hrms_inbound_event(event_id UNIQUE)`
   table makes it idempotent. Handling:
   - `EMPLOYEE_CREATED` → find by `external_employee_id`, else by email (link),
     else create `LmsUser` (+ Employee role, org, department/designation,
     `LmsUserReportingManagerMapping`); return `learner_id`.
   - `EMPLOYEE_UPDATED` / `ROLE_CHANGED` → update profile/org mapping, re-run
     role-based program enrolment.
   - `EMPLOYEE_STATUS_CHANGED` → `enabled=false` on `EXITED`, `true` otherwise.
   - `ONBOARDING_STAGE_CHANGED` / `onboarding.stage` → enrol in the onboarding
     program batch.
3. **Outbound webhooks**: an outbox table + scheduled sender (reuse `DlqMessages`
   for dead letters) emitting the inbound events above from learning-module
   status (`StudentLearningModuleStatus`), assessment results
   (`AssessmentResultHistory` / `UserExamStatus`), certificates and the existing
   Skill Passport.
4. **SSO**: `POST /auth/hrms-sso` in `lmsng-auth-services` — verify the token
   (HS256, `aud`, `iss`, `exp`), reject a reused `jti` (Redis `SETNX` with TTL),
   find the learner by `sub`, issue the normal token via
   `JwtUtils.generateTokenFromUsername`, redirect to `4AT-LMS-Frontend`
   `/sso?target=…`; the frontend stores it exactly as after `/signin`.
5. **Mapping config**: which HRMS department/designation → which LMS program /
   batch (role-based and onboarding learning paths).

## UAT mapping

| UAT | Covered by |
|---|---|
| 01 create → linked once | `test_new_active_employee_is_provisioned_exactly_once`, `test_delivery_links_the_learner` |
| 02 department | `test_department_change_syncs_profile` |
| 03 designation | `test_designation_change_raises_role_changed` |
| 04 onboarding path | `test_onboarding_stage_change_is_sent_for_linked_employees` (LMS side assigns) |
| 05 course completion | `test_enrolment_then_completion_shows_in_hrms` |
| 06 assessment | `test_assessment_result_is_projected` |
| 07/08 certification + expiry | `test_certification_and_expiry`, `test_expiring_certifications_on_dashboard` |
| 09 exit | `test_exit_raises_status_change`, `test_exit_delivery_deactivates_the_link` |
| 10 duplicate | `test_duplicate_event_is_acknowledged_not_reapplied`, `test_duplicate_delivery_409_counts_as_success` |
| 11 LMS down | `test_lms_outage_does_not_block_hr_and_is_retried` |
| 12 reconciliation | `test_reconciliation_reports_and_fixes` |
