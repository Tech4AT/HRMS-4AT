from django.urls import re_path
from rest_framework.routers import DefaultRouter

from audit.views import EmployeeActivityViewSet
from employees.analytics_views import OrgAnalyticsSummaryView, OrgHeadcountView
from employees.reports import (
    CustomReportViewSet,
    ReportCatalogView,
    ReportExportView,
    ReportRunView,
)
from employees.views import (
    AuthorizedSignatoryAdminViewSet,
    BandAdminViewSet,
    BusinessUnitAdminViewSet,
    BusinessUnitViewSet,
    CodeSchemeAdminViewSet,
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
    HierarchyRuleAdminViewSet,
    JobFamilyAdminViewSet,
    JobFamilyViewSet,
    JobTitleAdminViewSet,
    JobTitleViewSet,
    LegalEntityAdminViewSet,
    LegalEntityBankAccountAdminViewSet,
    LegalEntityViewSet,
    LevelAdminViewSet,
    LevelViewSet,
    LocationAdminViewSet,
    LocationViewSet,
    OrgDirectoryViewSet,
    OrgSettingAdminViewSet,
    PayGradeAdminViewSet,
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
# `designations` is the historic endpoint name (the model is JobTitle now);
# `job-titles` is canonical. Both serve the same rows.
router.register("designations", DesignationViewSet, basename="designation")
router.register("job-titles", JobTitleViewSet, basename="jobtitle")
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
router.register("org/job-titles", JobTitleAdminViewSet, basename="org-jobtitle")
router.register("org/locations", LocationAdminViewSet, basename="org-location")
router.register("org/legal-entities", LegalEntityAdminViewSet, basename="org-legalentity")
router.register(
    "org/authorized-signatories",
    AuthorizedSignatoryAdminViewSet,
    basename="org-authorizedsignatory",
)
router.register(
    "org/bank-details",
    LegalEntityBankAccountAdminViewSet,
    basename="org-bankdetail",
)
router.register("org/business-units", BusinessUnitAdminViewSet, basename="org-businessunit")
router.register("org/cost-centers", CostCenterAdminViewSet, basename="org-costcenter")
router.register("org/teams", TeamAdminViewSet, basename="org-team")
router.register("org/job-families", JobFamilyAdminViewSet, basename="org-jobfamily")
router.register("org/levels", LevelAdminViewSet, basename="org-level")
router.register("org/grades", GradeAdminViewSet, basename="org-grade")
router.register("org/pay-grades", PayGradeAdminViewSet, basename="org-paygrade")
router.register("org/bands", BandAdminViewSet, basename="org-band")
router.register("org/positions", PositionAdminViewSet, basename="org-position")
router.register("org/org-settings", OrgSettingAdminViewSet, basename="org-orgsetting")
router.register("org/code-schemes", CodeSchemeAdminViewSet, basename="org-codescheme")
router.register("org/hierarchy-rules", HierarchyRuleAdminViewSet, basename="org-hierarchyrule")

router.register("org/reports/custom", CustomReportViewSet, basename="org-report-custom")

urlpatterns = [
    # The frontend calls this without a trailing slash.
    re_path(r"^ess/profile/?$", EssProfileView.as_view(), name="ess-profile"),
    # Realtime org analytics (org.read; {success, data}, snake_case).
    re_path(r"^org/analytics/summary/?$", OrgAnalyticsSummaryView.as_view(), name="org-analytics-summary"),
    re_path(r"^org/analytics/headcount/?$", OrgHeadcountView.as_view(), name="org-analytics-headcount"),
    # Employee reports (org.read; {success, data}, snake_case).
    re_path(r"^org/reports/catalog/?$", ReportCatalogView.as_view(), name="org-reports-catalog"),
    re_path(r"^org/reports/run/?$", ReportRunView.as_view(), name="org-reports-run"),
    re_path(r"^org/reports/export/?$", ReportExportView.as_view(), name="org-reports-export"),
    *router.urls,
]
