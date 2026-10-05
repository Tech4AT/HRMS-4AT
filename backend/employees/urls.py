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
    JobTitleAdminViewSet,
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
from employees.views import (
    AuthorizedSignatoryAdminViewSet,
    BandAdminViewSet,
    CodeSchemeAdminViewSet,
    HierarchyRuleAdminViewSet,
    LegalEntityBankAccountAdminViewSet,
    OrgSettingAdminViewSet,
    PayGradeAdminViewSet,
)
from audit.views import EmployeeActivityViewSet
from employees.analytics_views import OrgAnalyticsSummaryView, OrgHeadcountView
from employees.reports import (
    CustomReportViewSet,
    ReportCatalogView,
    ReportExportView,
    ReportRunView,
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
router.register("org/employee-activity", EmployeeActivityViewSet, basename="org-employee-activity")
router.register("org/designations", DesignationAdminViewSet, basename="org-designation")
# Designation was renamed JobTitle; expose both paths against the same viewset so
# existing "org/designations" callers and the newer "org/job-titles" both resolve.
router.register("org/job-titles", JobTitleAdminViewSet, basename="org-jobtitle")
router.register("org/locations", LocationAdminViewSet, basename="org-location")
router.register("org/legal-entities", LegalEntityAdminViewSet, basename="org-legalentity")
router.register("org/business-units", BusinessUnitAdminViewSet, basename="org-businessunit")
router.register("org/cost-centers", CostCenterAdminViewSet, basename="org-costcenter")
router.register("org/teams", TeamAdminViewSet, basename="org-team")
router.register("org/job-families", JobFamilyAdminViewSet, basename="org-jobfamily")
router.register("org/levels", LevelAdminViewSet, basename="org-level")
router.register("org/grades", GradeAdminViewSet, basename="org-grade")
router.register("org/positions", PositionAdminViewSet, basename="org-position")
# Keka-style entity structure (org.manage): per-legal-entity signatories + bank
# accounts, and the pay-grade / band ladder.
router.register("org/authorized-signatories", AuthorizedSignatoryAdminViewSet, basename="org-signatory")
router.register("org/bank-details", LegalEntityBankAccountAdminViewSet, basename="org-bankaccount")
router.register("org/pay-grades", PayGradeAdminViewSet, basename="org-paygrade")
router.register("org/bands", BandAdminViewSet, basename="org-band")
# Employee-code schemes (with a next-code action), org settings, and hierarchy
# rules (with a validate action) — all org.manage.
router.register("org/code-schemes", CodeSchemeAdminViewSet, basename="org-codescheme")
router.register("org/org-settings", OrgSettingAdminViewSet, basename="org-setting")
router.register("org/hierarchy-rules", HierarchyRuleAdminViewSet, basename="org-hierarchyrule")

# Org reports (org.read): catalog of report types, run/export a report, and
# per-user saved custom reports.
router.register("org/reports/custom", CustomReportViewSet, basename="org-report-custom")

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
    re_path(r"^org/analytics/summary/?$", OrgAnalyticsSummaryView.as_view(), name="org-analytics-summary"),
    re_path(r"^org/analytics/headcount/?$", OrgHeadcountView.as_view(), name="org-analytics-headcount"),
    re_path(r"^org/reports/catalog/?$", ReportCatalogView.as_view(), name="org-report-catalog"),
    re_path(r"^org/reports/run/?$", ReportRunView.as_view(), name="org-report-run"),
    re_path(r"^org/reports/export/?$", ReportExportView.as_view(), name="org-report-export"),
    *router.urls,
]
