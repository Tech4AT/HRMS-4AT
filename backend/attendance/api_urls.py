"""Mounted automatically under /api/v1/ (config/api_urls.py).

trailing_slash=False: same reasoning as org_calendar/api_urls.py — every call
in lib/api/attendance.ts omits the trailing slash, and Django's default
APPEND_SLASH redirect can't preserve a POST body (check-in/out are POST)."""

from rest_framework.routers import DefaultRouter

from attendance.views import AttendanceRequestViewSet, AttendanceViewSet

router = DefaultRouter(trailing_slash=False)
router.register("attendance/requests", AttendanceRequestViewSet, basename="attendance-request")
router.register("attendance", AttendanceViewSet, basename="attendance")

urlpatterns = router.urls
