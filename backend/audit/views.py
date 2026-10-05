from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from audit.models import AuditLog
from audit.serializers import AuditLogSerializer, EmployeeActivitySerializer
from core.permissions import HasPermissionCode


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """The activity log, newest first. Read-only: the log is append-only and
    nothing in the API can change or remove an entry.

    Filters (all optional, combinable): ?search= (action, record, or who did it),
    ?action=, ?entity_type=, ?entity_id= (with entity_type: the history of one
    record), ?actor= (a user id)."""

    serializer_class = AuditLogSerializer
    permission_classes = [HasPermissionCode]
    required_permission = "audit.read"

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("actor").order_by("-id")
        params = self.request.query_params
        if params.get("action"):
            queryset = queryset.filter(action=params["action"])
        if params.get("entity_type"):
            queryset = queryset.filter(entity_type=params["entity_type"])
        if params.get("entity_id"):
            queryset = queryset.filter(entity_id=params["entity_id"])
        if params.get("actor"):
            queryset = queryset.filter(actor_id=params["actor"])
        search = params.get("search")
        if search:
            queryset = queryset.filter(
                Q(action__icontains=search)
                | Q(entity_type__icontains=search)
                | Q(entity_id__iexact=search)
                | Q(actor__email__icontains=search)
                | Q(actor__first_name__icontains=search)
                | Q(actor__last_name__icontains=search)
            )
        return queryset


# ---------------------------------------------------------------------------
# Employee activity: the same audit rows, framed per employee.
# ---------------------------------------------------------------------------

#: High-frequency / test-only rows with no employee meaning. Always trimmed
#: from the activity feed (the raw system view keeps them).
NOISE_ACTIONS = frozenset({"auth.token_refreshed", "test.action"})

#: action -> feed category. Unlisted actions fall in "other".
CATEGORY_ACTIONS = {
    "login": {
        "auth.login_succeeded",
        "auth.login_failed",
        "auth.login_locked_out",
        "auth.logout",
        "auth.session_revoked",
        "User.login_provisioned",
        "user.password_setup_completed",
    },
    "profile": {
        "Employee.created",
        "Employee.updated",
        "Employee.reactivated",
    },
    "role": {
        "User.role_changed",
        "User.active_status_changed",
        "Role.created",
        "Role.updated",
        "Role.members_added",
        "Role.members_removed",
        "RolePermission.created",
        "RolePermission.updated",
        "RolePermission.deleted",
        "UserPermissionOverride.created",
        "UserPermissionOverride.updated",
        "UserPermissionOverride.deleted",
    },
    "lifecycle": {
        "employee.exited",
        "employee.resignation_submitted",
        "employee.resignation_withdrawn",
        "employee.resignation_accepted",
        "employee.resignation_rejected",
        "employee.exit_initiated",
        "Request.created",
        "Request.approved",
        "Request.rejected",
        "Request.withdrawn",
    },
    "orgchange": {
        "OrgChange.created",
        "OrgChange.updated",
        "OrgChange.promotion",
        "OrgChange.transfer",
        "OrgChange.manager_change",
        "OrgChange.title_change",
        "OrgChange.department_change",
    },
    "structure": {
        "Department.created",
        "Department.updated",
        "Department.deleted",
        "JobTitle.created",
        "JobTitle.updated",
        "JobTitle.deleted",
        "Location.created",
        "Location.updated",
        "Location.deleted",
        "LegalEntity.created",
        "LegalEntity.updated",
        "LegalEntity.deleted",
        "BusinessUnit.created",
        "BusinessUnit.updated",
        "BusinessUnit.deleted",
        "CostCenter.created",
        "CostCenter.updated",
        "CostCenter.deleted",
        "Team.created",
        "Team.updated",
        "Team.deleted",
        "JobFamily.created",
        "JobFamily.updated",
        "JobFamily.deleted",
        "Level.created",
        "Level.updated",
        "Level.deleted",
        "Grade.created",
        "Grade.updated",
        "Grade.deleted",
        "Position.created",
        "Position.updated",
        "Position.deleted",
        "OrgSetting.created",
        "OrgSetting.updated",
        "OrgSetting.deleted",
        "CodeScheme.created",
        "CodeScheme.updated",
        "CodeScheme.deleted",
        "HierarchyRule.created",
        "HierarchyRule.updated",
        "HierarchyRule.deleted",
    },
}

_ACTION_TO_CATEGORY = {
    action: category for category, actions in CATEGORY_ACTIONS.items() for action in actions
}

_LOGIN_VERBS = {
    "auth.login_succeeded": "signed in",
    "auth.login_failed": "failed to sign in",
    "auth.login_locked_out": "was locked out signing in",
    "auth.logout": "signed out",
    "auth.session_revoked": "revoked a session",
    "User.login_provisioned": "was given login access",
    "user.password_setup_completed": "completed password setup",
}


def action_category(action):
    """Feed category for an audit action (unknown actions are "other")."""
    return _ACTION_TO_CATEGORY.get(action, "other")


def _employee_from_pk(pk, cache):
    if pk is None:
        return None
    from employees.models import Employee

    try:
        key = int(pk)
    except (TypeError, ValueError):
        return None
    if cache is not None and key in cache:
        return cache[key]
    employee = Employee.objects.select_related("user").filter(pk=key).first()
    if cache is not None:
        cache[key] = employee
    return employee


def resolve_subject(row, cache=None):
    """The employee an audit row is *about*, or None when no employee fits.

    Entity-first (a profile change is about its employee, a role grant about
    its user), then the diff's employee reference (org changes, exits), then
    the actor's own employee (logins, structure edits). Rows with neither an
    entity employee nor an actor employee (e.g. failed logins for unknown
    addresses) have no subject and are dropped from the feed.
    """
    from django.contrib.auth import get_user_model

    entity = (row.entity_type or "").lower()
    if entity == "employee":
        employee = _employee_from_pk(row.entity_id, cache)
        if employee is not None:
            return employee
    elif entity == "user":
        user = (
            get_user_model().objects.filter(pk=row.entity_id).first()
            if str(row.entity_id or "").isdigit()
            else None
        )
        employee = getattr(user, "employee", None) if user is not None else None
        if employee is not None:
            return employee
    diff = row.diff if isinstance(row.diff, dict) else {}
    for key in ("employee", "employeeId"):
        if key in diff:
            employee = _employee_from_pk(diff[key], cache)
            if employee is not None:
                return employee
    actor = row.actor
    return getattr(actor, "employee", None) if actor is not None else None


def summarize(row, employee_name=None):
    """One human line for a feed row (names only, no invented detail)."""
    actor = row.actor
    actor_name = (actor.get_full_name() or actor.email) if actor is not None else None
    subject = employee_name or "Someone"
    if row.action in _LOGIN_VERBS:
        text = f"{subject} {_LOGIN_VERBS[row.action]}"
        if actor_name and actor_name != subject:
            text += f" (by {actor_name})"
        return text
    pretty = row.action.replace("_", " ").replace(".", " — ")
    if actor_name and actor_name != subject:
        return f"{actor_name}: {pretty} · {subject}"
    return f"{subject}: {pretty}"


def _parse_date_bound(value, *, end_of_day=False):
    from datetime import datetime, time

    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError(f"Not a date: {value!r}. Use YYYY-MM-DD.")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.get_current_timezone())
    if len(value) <= 10:
        parsed = parsed.replace(hour=0, minute=0, second=0, microsecond=0)
    if end_of_day and len(value) <= 10:
        parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
    return parsed


class EmployeeActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """Per-employee activity: logins, profile/role/lifecycle changes and org
    edits, each framed around the employee it concerns — the employee-facing
    answer to the Audit tab, without the raw system noise.

    Same ``audit.read`` gate, camelCase + ``{results, total, page, pageSize}``
    convention as the system view (which stays intact at ``audit-log``).

    Filters (all optional, combinable): ``?employee=<id>`` (the subject),
    ``?category=<login|profile|role|lifecycle|orgchange|structure|other>``,
    ``?action=<exact action>``, ``?date_from=YYYY-MM-DD``,
    ``?date_to=YYYY-MM-DD`` (inclusive). ``auth.token_refreshed`` and
    ``test.action`` rows are always trimmed as noise."""

    serializer_class = EmployeeActivitySerializer
    permission_classes = [HasPermissionCode]
    required_permission = "audit.read"

    def get_queryset(self):
        params = self.request.query_params
        queryset = (
            AuditLog.objects.select_related("actor", "actor__employee")
            .exclude(action__in=NOISE_ACTIONS)
            # Employee-framed: keep rows that resolve to a subject — an
            # employee/user entity, a diff employee reference, or an actor
            # with an employee record. (Stale entity pks from deleted rows
            # are trimmed per-row in list(); unknown-address login failures
            # have no subject and never enter the feed.)
            .filter(
                Q(entity_type__iexact="employee")
                | Q(entity_type__iexact="user")
                | Q(diff__has_key="employee")
                | Q(diff__has_key="employeeId")
                | Q(actor__employee__isnull=False)
            )
            .order_by("-id")
        )
        employee_id = params.get("employee")
        if employee_id:
            if not employee_id.isdigit():
                raise ValidationError(f"Not an employee id: {employee_id!r}.")
            from django.contrib.auth import get_user_model

            user_ids = list(
                get_user_model()
                .objects.filter(employee__pk=int(employee_id))
                .values_list("pk", flat=True)
            )
            queryset = queryset.filter(
                Q(entity_type__iexact="employee", entity_id=employee_id)
                | Q(entity_type__iexact="user", entity_id__in=[str(u) for u in user_ids])
                | (
                    Q(actor__employee__pk=int(employee_id))
                    & ~Q(entity_type__iexact="employee")
                    & ~Q(entity_type__iexact="user")
                )
            )
        category = params.get("category")
        if category:
            actions = CATEGORY_ACTIONS.get(category)
            if actions is None:
                raise ValidationError(
                    f"Unknown category {category!r}. Use one of: "
                    + ", ".join(sorted(CATEGORY_ACTIONS)) + ", other."
                )
            queryset = queryset.filter(action__in=actions)
            if category == "other":
                known = set(_ACTION_TO_CATEGORY)
                queryset = queryset.exclude(action__in=known)
        action = params.get("action")
        if action:
            queryset = queryset.filter(action=action)
        if params.get("date_from"):
            queryset = queryset.filter(created_at__gte=_parse_date_bound(params["date_from"]))
        if params.get("date_to"):
            queryset = queryset.filter(
                created_at__lte=_parse_date_bound(params["date_to"], end_of_day=True)
            )
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["employee_cache"] = {}
        return context

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # Rows with no resolvable subject (unknown login addresses) carry no
        # employee meaning — drop them from the feed, keep the total honest.
        response.data["results"] = [
            row for row in response.data["results"] if row["employee"] is not None
        ]
        return response
