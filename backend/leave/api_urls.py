"""Mounted automatically under /api/v1/ (config/api_urls.py).

trailing_slash=False: same reasoning as org_calendar/attendance — every call
in lib/api/leave.ts omits the trailing slash."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from leave.views import HolidayViewSet, LeaveBalanceViewSet, LeaveRequestViewSet, LeaveTypeViewSet

router = DefaultRouter(trailing_slash=False)
router.register("leave/types", LeaveTypeViewSet, basename="leave-type")
router.register("leave/balance", LeaveBalanceViewSet, basename="leave-balance")
router.register("leave/requests", LeaveRequestViewSet, basename="leave-request")
router.register("leave/holidays", HolidayViewSet, basename="leave-holiday")

urlpatterns = [
    # lib/api/leave.ts's getPendingApprovals() calls `/leave/approvals/pending`
    # (no `/requests/` segment, unlike attendance.ts's equivalent) — this is
    # that pre-existing frontend contract's exact path, not a new one invented
    # for symmetry with attendance. Same view/action as the router-generated
    # `leave/requests/approvals/pending` below; both work, this one is the one
    # the frontend actually calls.
    path(
        "leave/approvals/pending",
        LeaveRequestViewSet.as_view({"get": "approvals_pending"}),
        name="leave-approvals-pending",
    ),
    # Same story as above, for getApprovalHistory()'s `/leave/approvals/history`.
    path(
        "leave/approvals/history",
        LeaveRequestViewSet.as_view({"get": "approvals_history"}),
        name="leave-approvals-history",
    ),
    *router.urls,
]
