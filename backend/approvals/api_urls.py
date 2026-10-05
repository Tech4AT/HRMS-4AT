"""trailing_slash=False: found broken during manual verification of Steps 3-5
— frontend/src/app/api/requests/[[...path]]/route.ts's generic proxy never
appends a trailing slash (createBackendProxyRoute's `/${prefix}/${path.join
('/')}` pattern) for a sub-path like `{id}/approve`, so with the default DRF
router every decide action (`POST /requests/{id}/approve`) hit Django's
APPEND_SLASH redirect, which can't preserve a POST body and 500s. Same fix,
same reasoning, as org_calendar/attendance/leave's api_urls.py — this app just
hadn't been updated for it yet.

One wrinkle unique to this app: `requests` is the only prefix whose frontend
route is an *optional* catch-all (`[[...path]]`, not `[...path]`), because
requestsApi.list() calls the bare prefix with no sub-path at all. For that one
case, the shared proxy helper's `/${prefix}/${path.join('/')}` template
*always* supplies a trailing slash (path=[] joins to '', leaving the literal
`/` before it) — so the bare list/create route needs to keep accepting a
trailing slash even though every other route on this router does not. Handled
below with one explicit extra path, rather than turning trailing_slash back on
for everything and reintroducing the original bug."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import RequestViewSet

router = DefaultRouter(trailing_slash=False)
router.register("requests", RequestViewSet, basename="request")

urlpatterns = [
    path("requests/", RequestViewSet.as_view({"get": "list", "post": "create"})),
    *router.urls,
]
