"""Realtime organisation analytics over the live directory.

Two read endpoints (both ``org.read``-gated, ``{success, data}`` snake_case
envelope like the other org read lists — plain JSON, no camelCase):

- ``GET /api/v1/org/analytics/summary/`` — one response with every
  Summary/Analytics chart breakdown: headcount by department, location,
  business unit, employment type and status, all counted live from the
  Employee table.
- ``GET /api/v1/org/analytics/headcount/?by=<dimension>`` — one breakdown
  at a time, with optional filters (``department``, ``location``,
  ``business_unit``, ``cost_center``, ``legal_entity``, ``employment_type``,
  ``status``). Dimensions: department, location, business_unit,
  cost_center, legal_entity, grade, level, employment_type, status.

Headcount counts everyone except exited employees; ``by_status`` is the one
breakdown that includes the exited bucket (that is where exits are
visible). Employees with no value on a dimension sit in an ``Unassigned``
bucket (``id`` null) — the same convention the frontend charts use.

Honest gaps, never fabricated: grade and level are not assigned to any
employee in the roster import, so while that is true those dimensions
return a ``withheld`` marker instead of buckets (``{"withheld":
"no-source-data", "detail": ...}``). The moment HR assigns grades/levels
the same endpoints start returning real buckets — no code change. Gender,
age and tenure/join-date analytics are genuinely absent from the source
data too (``gender``/``dob``/``date_of_joining`` are empty for the whole
directory) and are reported under ``unavailable`` in the summary rather
than charted.
"""

from django.db.models import Count
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import HasPermissionCode
from employees.models import Employee

UNASSIGNED = "Unassigned"

# Fields the roster import never fills (empty for all 146). Returned as an
# honest marker, never charted. (Checked live: gender/dob/date_of_joining/
# date_of_exit are blank on every loaded row.)
UNAVAILABLE = {
    "gender": "The roster carries no gender data, so no gender breakdown is available.",
    "age": "Dates of birth are not tracked, so no age breakdown is available.",
    "tenure": "Join dates are not tracked, so no tenure breakdown is available.",
    "growth": "Join/exit dates are not tracked, so growth and retention rates cannot be computed.",
    "attrition_rate": "Exit dates are not tracked, so attrition rates cannot be computed.",
}

WITHHELD_NO_SOURCE_DATA = "no-source-data"

DIMENSIONS = (
    "department",
    "location",
    "business_unit",
    "cost_center",
    "legal_entity",
    "grade",
    "level",
    "employment_type",
    "work_mode",
    "status",
)

FILTER_FIELDS = (
    "department",
    "location",
    "business_unit",
    "cost_center",
    "legal_entity",
    "employment_type",
    "work_mode",
    "status",
)


def _base_queryset(params, *, for_status_breakdown=False):
    """Employees filtered by the query params; exited excluded by default."""
    queryset = Employee.objects.all()
    for field in FILTER_FIELDS:
        value = params.get(field)
        if value:
            queryset = queryset.filter(**{f"{field}__in": value.split(",")})
    if not for_status_breakdown and "status" not in params:
        queryset = queryset.exclude(status=Employee.STATUS_EXITED)
    return queryset


def _buckets(queryset, dimension):
    """``[{id, name, headcount}]`` for one FK dimension, live from the DB."""
    rows = (
        queryset.values(dimension)
        .annotate(headcount=Count("id"))
        .order_by("-headcount", dimension)
    )
    ids = [r[dimension] for r in rows if r[dimension] is not None]
    names = {}
    if ids:
        model = Employee._meta.get_field(dimension).related_model
        names = dict(model.objects.filter(pk__in=ids).values_list("pk", "name"))
    buckets = []
    for row in rows:
        pk = row[dimension]
        buckets.append(
            {
                "id": pk,
                "name": names.get(pk, UNASSIGNED) if pk is not None else UNASSIGNED,
                "headcount": row["headcount"],
            }
        )
    return buckets


def _value_buckets(queryset, dimension):
    """``[{id, name, headcount}]`` for a plain-value dimension (status, type)."""
    rows = (
        queryset.values(dimension)
        .annotate(headcount=Count("id"))
        .order_by("-headcount", dimension)
    )
    return [
        {"id": None, "name": r[dimension] or UNASSIGNED, "headcount": r["headcount"]}
        for r in rows
    ]


def _dimension_payload(queryset, dimension):
    """Buckets for a dimension, or a withheld marker when the source data is
    genuinely absent (no employee carries a value on it)."""
    if dimension in ("status", "employment_type"):
        return {
            "dimension": dimension,
            "buckets": _value_buckets(queryset, dimension),
            "total": queryset.count(),
        }
    if not queryset.filter(**{f"{dimension}__isnull": False}).exists():
        return {
            "dimension": dimension,
            "buckets": [],
            "total": 0,
            "withheld": WITHHELD_NO_SOURCE_DATA,
            "detail": (
                f"No employee has a {dimension.replace('_', ' ')} assigned, "
                "so no breakdown can be computed. Assign values and this "
                "endpoint returns real buckets."
            ),
        }
    return {
        "dimension": dimension,
        "buckets": _buckets(queryset, dimension),
        "total": queryset.count(),
    }


class OrgAnalyticsSummaryView(APIView):
    """Every Summary/Analytics chart breakdown in one response (org.read)."""

    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]

    def get(self, request):
        queryset = _base_queryset(request.query_params)
        data = {
            "total_headcount": queryset.count(),
            "total_records": Employee.objects.count(),
            "by_department": _buckets(queryset, "department"),
            "by_location": _buckets(queryset, "location"),
            "by_business_unit": _buckets(queryset, "business_unit"),
            "by_employment_type": _value_buckets(queryset, "employment_type"),
            "by_status": _value_buckets(
                _base_queryset(request.query_params, for_status_breakdown=True),
                "status",
            ),
            "by_grade": _dimension_payload(queryset, "grade"),
            "by_level": _dimension_payload(queryset, "level"),
            "unavailable": UNAVAILABLE,
        }
        return Response({"success": True, "data": data})


class OrgHeadcountView(APIView):
    """One headcount breakdown: ``?by=<dimension>`` plus optional filters."""

    permission_classes = [HasPermissionCode]
    required_permission = "org.read"
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]

    def get(self, request):
        dimension = request.query_params.get("by", "department")
        if dimension not in DIMENSIONS:
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": "UNKNOWN_DIMENSION",
                        "message": f"Unknown dimension '{dimension}'.",
                        "fields": {"by": sorted(DIMENSIONS)},
                    },
                },
                status=400,
            )
        queryset = _base_queryset(
            request.query_params, for_status_breakdown=(dimension == "status")
        )
        return Response({"success": True, "data": _dimension_payload(queryset, dimension)})
