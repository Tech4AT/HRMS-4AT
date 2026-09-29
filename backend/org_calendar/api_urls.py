"""Mounted automatically under /api/v1/ (config/api_urls.py). Kept at the
`calendar/...` URL prefix the frontend already proxies to
(frontend/src/app/api/calendar/[...path]/route.ts) even though the Python
app is named `org_calendar` (to avoid shadowing the stdlib `calendar`
module) - the URL prefix is independent of the Django app label.

trailing_slash=False: every call in lib/api/calendar.ts omits the trailing
slash (e.g. `POST /entries`, not `/entries/`). Django's default APPEND_SLASH
redirect can't preserve a POST body, so a slash-requiring router 500s on
every create/update instead of 404ing harmlessly - confirmed live, not
theoretical. Scoped to this router only, not a project-wide APPEND_SLASH
change in config/settings."""

from rest_framework.routers import DefaultRouter

from org_calendar.views import CalendarEntryViewSet, RecurringWfhRuleViewSet, WeekOffViewSet

router = DefaultRouter(trailing_slash=False)
router.register("calendar/entries", CalendarEntryViewSet, basename="calendar-entry")
router.register("calendar/recurring-wfh", RecurringWfhRuleViewSet, basename="recurring-wfh-rule")
router.register("calendar/week-off", WeekOffViewSet, basename="week-off")

urlpatterns = router.urls
