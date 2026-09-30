from django.urls import re_path
from rest_framework.routers import DefaultRouter

from employees.profile_views import (
    ProfileAboutView,
    ProfileAddressView,
    ProfileEmergencyContactDetailView,
    ProfileEmergencyContactsView,
    ProfileNameView,
    ProfilePersonalView,
    ProfileSkillDetailView,
    ProfileSkillsView,
    ProfileTimelineView,
    ProfileView,
)
from employees.views import (
    BusinessUnitAdminViewSet,
    BusinessUnitViewSet,
    CostCenterAdminViewSet,
    CostCenterViewSet,
    DepartmentAdminViewSet,
    DepartmentViewSet,
    DesignationAdminViewSet,
    DesignationViewSet,
    EmployeeViewSet,
    EssProfileView,
    GradeAdminViewSet,
    GradeViewSet,
    JobFamilyAdminViewSet,
    JobFamilyViewSet,
    LegalEntityAdminViewSet,
    LegalEntityViewSet,
    LevelAdminViewSet,
    LevelViewSet,
    LocationAdminViewSet,
    LocationViewSet,
    OrgDirectoryViewSet,
    PositionAdminViewSet,
    PositionViewSet,
    TeamAdminViewSet,
    TeamViewSet,
)

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
# Company-wide org directory (unscoped, read-only) — powers the Organisation
# page's chart/directory for every user, regardless of RBAC scope.
router.register("org-directory", OrgDirectoryViewSet, basename="org-directory")

# Read-only lists the frontend pages call ({success, data}, snake_case).
router.register("departments", DepartmentViewSet, basename="department")
router.register("designations", DesignationViewSet, basename="designation")
router.register("locations", LocationViewSet, basename="location")
router.register("legal-entities", LegalEntityViewSet, basename="legalentity")
router.register("business-units", BusinessUnitViewSet, basename="businessunit")
router.register("cost-centers", CostCenterViewSet, basename="costcenter")
router.register("teams", TeamViewSet, basename="team")
router.register("job-families", JobFamilyViewSet, basename="jobfamily")
router.register("levels", LevelViewSet, basename="level")
router.register("grades", GradeViewSet, basename="grade")
router.register("positions", PositionViewSet, basename="position")

# Managing the structure (org.manage; camelCase, paginated, audited).
router.register("org/departments", DepartmentAdminViewSet, basename="org-department")
router.register("org/designations", DesignationAdminViewSet, basename="org-designation")
router.register("org/locations", LocationAdminViewSet, basename="org-location")
router.register("org/legal-entities", LegalEntityAdminViewSet, basename="org-legalentity")
router.register("org/business-units", BusinessUnitAdminViewSet, basename="org-businessunit")
router.register("org/cost-centers", CostCenterAdminViewSet, basename="org-costcenter")
router.register("org/teams", TeamAdminViewSet, basename="org-team")
router.register("org/job-families", JobFamilyAdminViewSet, basename="org-jobfamily")
router.register("org/levels", LevelAdminViewSet, basename="org-level")
router.register("org/grades", GradeAdminViewSet, basename="org-grade")
router.register("org/positions", PositionAdminViewSet, basename="org-position")

# Employee 360 profile. `<pk>` is an employee id or `me`. Registered ahead of the
# router so `employees/<pk>/profile/…` is never mistaken for a viewset action.
_PROFILE = r"^employees/(?P<pk>me|\d+)/profile"

urlpatterns = [
    # The frontend calls this without a trailing slash.
    re_path(r"^ess/profile/?$", EssProfileView.as_view(), name="ess-profile"),
    re_path(rf"{_PROFILE}/?$", ProfileView.as_view(), name="employee-profile"),
    re_path(
        rf"{_PROFILE}/timeline/?$", ProfileTimelineView.as_view(), name="employee-profile-timeline"
    ),
    re_path(rf"{_PROFILE}/about/?$", ProfileAboutView.as_view(), name="employee-profile-about"),
    re_path(rf"{_PROFILE}/skills/?$", ProfileSkillsView.as_view(), name="employee-profile-skills"),
    re_path(
        rf"{_PROFILE}/skills/(?P<skill_id>\d+)/?$",
        ProfileSkillDetailView.as_view(),
        name="employee-profile-skill",
    ),
    re_path(rf"{_PROFILE}/name/?$", ProfileNameView.as_view(), name="employee-profile-name"),
    re_path(
        rf"{_PROFILE}/personal/?$", ProfilePersonalView.as_view(), name="employee-profile-personal"
    ),
    re_path(
        rf"{_PROFILE}/address/?$", ProfileAddressView.as_view(), name="employee-profile-address"
    ),
    re_path(
        rf"{_PROFILE}/emergency-contacts/?$",
        ProfileEmergencyContactsView.as_view(),
        name="employee-profile-emergency-contacts",
    ),
    re_path(
        rf"{_PROFILE}/emergency-contacts/(?P<contact_id>\d+)/?$",
        ProfileEmergencyContactDetailView.as_view(),
        name="employee-profile-emergency-contact",
    ),
    *router.urls,
]
