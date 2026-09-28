"""Mounted automatically under /api/v1/ (config/api_urls.py).

trailing_slash=False: same reasoning as org_calendar/api_urls.py — every call
in lib/api/attendance.ts omits the trailing slash, and Django's default
APPEND_SLASH redirect can't preserve a POST body (check-in/out are POST)."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from attendance.settings_views import PolicySettingsView, ShiftViewSet
from attendance.views import AttendanceRequestViewSet, AttendanceViewSet

router = DefaultRouter(trailing_slash=False)
router.register("attendance/requests", AttendanceRequestViewSet, basename="attendance-request")
router.register("attendance/shifts", ShiftViewSet, basename="shift")
router.register("attendance", AttendanceViewSet, basename="attendance")

urlpatterns = [
    # A singleton, not a router-registered resource — see PolicySettingsView's
    # own docstring for why.
    path(
        "attendance/policy-settings",
        PolicySettingsView.as_view(),
        name="attendance-policy-settings",
    ),
    *router.urls,
]
