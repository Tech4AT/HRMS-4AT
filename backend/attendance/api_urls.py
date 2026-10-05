"""Mounted automatically under /api/v1/ (config/api_urls.py).

trailing_slash=False: same reasoning as org_calendar/api_urls.py — every call
in lib/api/attendance.ts omits the trailing slash, and Django's default
APPEND_SLASH redirect can't preserve a POST body (check-in/out are POST)."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from attendance.penalisation_views import MyPenalisationsView, PenalisationViewSet
from attendance.settings_views import PolicySettingsView, ShiftViewSet
from attendance.team_views import (
    TeamDailyAttendanceView,
    TeamMemberAttendanceView,
    TeamSummaryView,
)
from attendance.views import AttendanceRequestViewSet, AttendanceViewSet

router = DefaultRouter(trailing_slash=False)
router.register("attendance/requests", AttendanceRequestViewSet, basename="attendance-request")
router.register("attendance/shifts", ShiftViewSet, basename="shift")
router.register("attendance/penalisations", PenalisationViewSet, basename="penalisation")
router.register("attendance", AttendanceViewSet, basename="attendance")

urlpatterns = [
    # A singleton, not a router-registered resource — see PolicySettingsView's
    # own docstring for why.
    path(
        "attendance/policy-settings",
        PolicySettingsView.as_view(),
        name="attendance-policy-settings",
    ),
    # The caller's own Penalisations, read-only — a plain APIView, not part of
    # PenalisationViewSet's HR-only, `penalisation.manage`-gated router
    # registration above (see penalisation_views.py's own docstring for why
    # these are two separate views, not one branching on permission).
    path(
        "attendance/penalisations/mine",
        MyPenalisationsView.as_view(),
        name="attendance-my-penalisations",
    ),
    # The Dashboard's scoped multi-employee read (PLAN.md Step 9) — a plain
    # APIView, not part of the AttendanceViewSet router below (a different
    # renderer/permission shape entirely, not a self-service action).
    path(
        "attendance/team/daily",
        TeamDailyAttendanceView.as_view(),
        name="attendance-team-daily",
    ),
    # My Team: one group (direct / indirect / peers) of the caller, with the
    # detail level each member's attendance may be shown at.
    path(
        "attendance/team/summary",
        TeamSummaryView.as_view(),
        name="attendance-team-summary",
    ),
    # One person's day-by-day detail (times, breaks), for people the caller may
    # read in full.
    path(
        "attendance/team/member/<int:pk>",
        TeamMemberAttendanceView.as_view(),
        name="attendance-team-member",
    ),
    *router.urls,
]
