"""Mounted automatically under /api/v1/ (config/api_urls.py)."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from lms_integration import views

P = "integrations/lms/"

router = DefaultRouter()
router.register(f"{P}enrollments", views.EnrollmentViewSet, basename="lms-enrollment")
router.register(f"{P}certifications", views.CertificationViewSet, basename="lms-certification")

urlpatterns = [
    path(f"{P}learners", views.LearnersView.as_view()),
    path(f"{P}learners/<str:employee_id>", views.LearnerResyncView.as_view()),
    path(f"{P}learners/<str:employee_id>/reset-link", views.LinkResetView.as_view()),
    path(f"{P}learners/<str:employee_id>/summary", views.LearnerSummaryView.as_view()),
    path(f"{P}learners/<str:employee_id>/courses", views.LearnerCoursesView.as_view()),
    path(f"{P}learners/<str:employee_id>/assessments", views.LearnerAssessmentsView.as_view()),
    path(
        f"{P}learners/<str:employee_id>/certifications", views.LearnerCertificationsView.as_view()
    ),
    path(f"{P}learners/<str:employee_id>/skills", views.LearnerSkillsView.as_view()),
    path(f"{P}events", views.InboundEventsView.as_view()),
    path(f"{P}reconcile", views.ReconcileView.as_view()),
    path(f"{P}reconcile/<int:run_id>", views.ReconcileDetailView.as_view()),
    path(f"{P}sync-jobs", views.SyncJobsView.as_view()),
    path(f"{P}sync-jobs/<str:job_id>", views.SyncJobDetailView.as_view()),
    path(f"{P}sync-jobs/<str:job_id>/retry", views.SyncJobRetryView.as_view()),
    path(f"{P}health", views.HealthView.as_view()),
    path(f"{P}compliance", views.ComplianceView.as_view()),
    path(f"{P}sso/launch", views.SsoLaunchView.as_view()),
    *router.urls,
]
