"""Plug-in conformance kit: one declaration, and the core proves a module's
endpoint honours RBAC.

A module author describes their endpoint once:

    ENDPOINT = ScopedEndpoint(
        label="Leave requests",
        list_url="/api/v1/leave/requests/",
        detail_url=lambda pk: f"/api/v1/leave/requests/{pk}/",
        read_permission="leave.read",
        create_record=lambda employee: LeaveRequest.objects.create(employee=employee).pk,
        write_permission="leave.write",
        create_payload={"reason": "Holiday"},
        actions=[ActionSpec("approve", lambda pk: f"/api/v1/leave/requests/{pk}/approve/",
                            "leave.approve", audit_action="LeaveRequest.approved")],
    )

and runs it two ways with no extra code:

- live, in a verify command:  `run_conformance(v, org, ENDPOINT)`
- in pytest:                  `assert_module_conforms(ENDPOINT)`  (core.testing)

What is checked, against the fictional organisation in core.fictional_org and
expectations written out by hand (never computed by the resolver under test):

  - the module's permissions are registered, and the startup checks pass
  - anonymous callers get 401; a caller holding nothing gets 403
  - for every one of the 7 scope tiers, a list returns exactly the records of
    the people that tier must cover, and no one else's
  - opening an in-scope record works (200); an out-of-scope one is 403
  - an explicit per-person deny beats a role grant
  - create needs the write permission (read alone is refused), and the owner is
    always the caller even if the body names someone else
  - each custom action needs its own permission, is scope-checked per record,
    and (optionally) writes the audit entry the module promises
"""

from dataclasses import dataclass, field
from typing import Any, Callable

from django.core.checks import run_checks

from accounts.models import Permission, UserPermissionOverride
from audit.models import AuditLog
from core.checks import check_view_permission_codes
from core.enums import ScopeTier
from core.fictional_org import PASSWORD, TIER_EXPECTATIONS, FictionalOrg
from core.registry import is_registered


def default_owner(row):
    """The employee id a JSON row belongs to: `employee`, `employee_id` or
    `employeeId`, either a bare id or a nested object with an `id`."""
    for key in ("employee", "employee_id", "employeeId"):
        if key in row:
            value = row[key]
            return value["id"] if isinstance(value, dict) else value
    raise KeyError(
        "Cannot tell which employee a row belongs to. Expose an `employee` field, or pass "
        f"owner_of=... to ScopedEndpoint. Row keys: {sorted(row)}"
    )


def extract_rows(response):
    """List rows from a bare list, {results: [...]} or {success, data: [...]}."""
    body = response.json()
    if isinstance(body, list):
        return body
    for key in ("results", "data"):
        value = body.get(key) if isinstance(body, dict) else None
        if isinstance(value, list):
            return value
        if isinstance(value, dict) and isinstance(value.get("results"), list):
            return value["results"]
    return []


@dataclass
class ActionSpec:
    name: str
    url: Callable[[Any], str]
    permission: str
    method: str = "post"
    success: tuple = (200, 201, 202, 204)
    audit_action: str | None = None


@dataclass
class ScopedEndpoint:
    label: str
    list_url: str
    detail_url: Callable[[Any], str]
    read_permission: str
    create_record: Callable[[Any], Any]  # (Employee) -> pk of a new record they own
    owner_of: Callable[[dict], Any] = default_owner
    write_permission: str | None = None
    create_payload: dict | None = None
    actions: list = field(default_factory=list)


def _owners(org, endpoint, response):
    rows = extract_rows(response) if response.status_code == 200 else []
    keys, others = set(), 0
    for row in rows:
        key = org.by_id.get(str(endpoint.owner_of(row)))
        if key is None:
            others += 1
        else:
            keys.add(key)
    return keys, others


def run_conformance(v, org: FictionalOrg, endpoint: ScopedEndpoint):
    """Run every conformance check for `endpoint`, reporting through `v`
    (a core.verification.Verifier). Must run inside the verification harness's
    rolled-back transaction (or a test), since it creates users and records."""
    read = endpoint.read_permission
    all_codes = [read, endpoint.write_permission, *[a.permission for a in endpoint.actions]]
    all_codes = [c for c in all_codes if c]

    v.section(f"Plug-in conformance: {endpoint.label}")

    # -- wiring ------------------------------------------------------------
    unregistered = [c for c in all_codes if not is_registered(c)]
    v.check(
        "every permission the module uses is registered (rbac.py)",
        not unregistered,
        f"not registered: {unregistered}",
    )
    missing_rows = [c for c in all_codes if not Permission.objects.filter(code=c).exists()]
    v.check(
        "the permissions exist in the database after migrate",
        not missing_rows,
        f"missing rows: {missing_rows}",
    )
    problems = [f"{e.id}: {e.msg}" for e in check_view_permission_codes(None)]
    problems += [f"{e.id}: {e.msg}" for e in run_checks() if e.is_serious()]
    v.check("startup checks report no wiring errors", not problems, "; ".join(problems))

    # one record owned by each person, so every scope has something to find
    records = {key: endpoint.create_record(emp) for key, emp in org.people.items()}

    def login(key):
        return v.login(key, org.email(key), PASSWORD)

    def sees(session, expected_keys, label, allow_others=False):
        """The caller sees exactly `expected_keys` of the fictional people. At the
        widest tier `allow_others` is set: a database that already holds real
        records legitimately shows them too, so only the fictional people are
        compared there."""
        response = session.get(endpoint.list_url)
        keys, others = _owners(org, endpoint, response)
        v.note(f"sees records of: {org.names(keys)}" + (f" (+{others} others)" if others else ""))
        v.check(
            label,
            response.status_code == 200
            and keys == set(expected_keys)
            and (others == 0 or allow_others),
            f"HTTP {response.status_code}; expected {org.names(expected_keys)}, "
            f"got {org.names(keys)} +{others} others",
        )

    # -- authentication and no-permission ------------------------------------
    anonymous = v.session("anon").get(endpoint.list_url)
    v.check(
        "anonymous callers are refused (401)",
        anonymous.status_code == 401,
        f"got HTTP {anonymous.status_code}",
    )

    # Eve keeps her employee record (and its self-service baseline), so she can
    # never be the permission-less caller: the outsider has no employee record
    # and therefore genuinely holds nothing.
    outsider = org.add_user_without_permissions()
    nothing = login(outsider).get(endpoint.list_url)
    v.check(
        "a signed-in caller holding no permissions is refused (403)",
        nothing.status_code == 403,
        f"got HTTP {nothing.status_code}",
    )

    # -- every scope tier ----------------------------------------------------
    for tier in ScopeTier.values:
        persona, expected = TIER_EXPECTATIONS[tier]
        v.note(f"--- tier '{tier}' as {org.first_name(persona)}")
        org.give_permission(persona, read, tier)
        session = login(persona)
        sees(
            session,
            expected,
            f"list under '{tier}' returns exactly the right people's records",
            allow_others=tier == ScopeTier.ALL,
        )

        inside = sorted(expected - {persona})
        outside = sorted(set(org.people) - expected)
        if inside:
            r = session.get(endpoint.detail_url(records[inside[0]]))
            v.check(
                f"an in-scope record ({org.first_name(inside[0])}'s) opens (200)",
                r.status_code == 200,
                f"got HTTP {r.status_code}",
            )
        if outside:
            r = session.get(endpoint.detail_url(records[outside[0]]))
            v.check(
                f"an out-of-scope record ({org.first_name(outside[0])}'s) is refused (403)",
                r.status_code == 403,
                f"got HTTP {r.status_code}",
            )

    # -- explicit deny beats a role grant --------------------------------------
    v.note("--- per-person deny")
    org.give_permission("eli", read, ScopeTier.ALL)
    UserPermissionOverride.objects.create(
        user=org.people["eli"].user,
        permission=Permission.objects.get(code=read),
        scope_tier=ScopeTier.ALL,
        is_granted=False,
    )
    denied = login("eli").get(endpoint.list_url)
    v.check(
        "an explicit deny overrides the role's grant (403)",
        denied.status_code == 403,
        f"got HTTP {denied.status_code}",
    )
    # The deny must not leak into later checks: with it left in place, "read alone
    # cannot create" would pass for the wrong reason (the caller is denied everything).
    UserPermissionOverride.objects.filter(user=org.people["eli"].user).delete()

    # -- create ------------------------------------------------------------------
    if endpoint.write_permission and endpoint.create_payload is not None:
        v.note("--- create")
        body = {**endpoint.create_payload, "employee": org.people["sam"].pk}

        org.give_permission("eli", read, ScopeTier.SELF)
        # Eli is an employee, so the self-service baseline may grant the write
        # permission too — explicitly deny it to model "read alone" precisely
        # (a no-op for modules whose write code is outside the baseline).
        write_perm = Permission.objects.get(code=endpoint.write_permission)
        UserPermissionOverride.objects.create(
            user=org.people["eli"].user,
            permission=write_perm,
            scope_tier=ScopeTier.SELF,
            is_granted=False,
        )
        r = login("eli").post(endpoint.list_url, body)
        v.check(
            "read permission alone cannot create (403)",
            r.status_code == 403,
            f"got HTTP {r.status_code}",
        )
        UserPermissionOverride.objects.filter(
            user=org.people["eli"].user, permission=write_perm
        ).delete()

        org.give_permission("eli", endpoint.write_permission, ScopeTier.SELF)
        r = login("eli").post(endpoint.list_url, body)
        created = r.status_code == 201
        v.check("the write permission allows create (201)", created, f"got HTTP {r.status_code}")
        if created:
            owner = str(endpoint.owner_of(r.json()))
            v.check(
                "the owner is the caller, even though the body named someone else",
                owner == str(org.people["eli"].pk),
                f"owner {owner!r}, caller {org.people['eli'].pk}, body named {body['employee']}",
            )
    elif endpoint.write_permission:
        v.note("create checks skipped: pass create_payload=... to ScopedEndpoint to enable them")

    # -- custom actions ---------------------------------------------------------
    for spec in endpoint.actions:
        v.note(f"--- action '{spec.name}'")
        call = lambda session, pk: getattr(session, spec.method)(spec.url(pk))  # noqa: E731

        org.give_permission("maya", read, ScopeTier.MANAGER)
        r = call(login("maya"), records["eli"])
        v.check(
            f"'{spec.name}' is refused to someone who can only read (403)",
            r.status_code == 403,
            f"got HTTP {r.status_code}",
        )

        org.give_permission("maya", spec.permission, ScopeTier.MANAGER)
        session = login("maya")
        r = call(session, records["eli"])
        v.check(
            f"'{spec.name}' works on an in-scope record ({r.status_code})",
            r.status_code in spec.success,
            f"got HTTP {r.status_code}",
        )
        if spec.audit_action:
            v.check(
                f"'{spec.name}' wrote the audit entry '{spec.audit_action}'",
                AuditLog.objects.filter(action=spec.audit_action).exists(),
            )
        r = call(session, records["sam"])
        v.check(
            f"'{spec.name}' is refused on an out-of-scope record (403)",
            r.status_code == 403,
            f"got HTTP {r.status_code}",
        )
