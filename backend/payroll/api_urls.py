"""Payroll API routes, mounted under /api/v1/ by config.api_urls
(endpoint catalogue: Payroll API & Backend Contract §6)."""

from rest_framework.routers import DefaultRouter

from payroll.views import config, outputs, people, processing

router = DefaultRouter()
router.include_root_view = False

# Configuration (PAY-001, PAY-002, statutory rules, pay groups)
router.register("payroll/components", config.ComponentViewSet, basename="payroll-component")
router.register("payroll/salary-structures", config.StructureViewSet, basename="payroll-structure")
router.register(
    "payroll/statutory-rules", config.StatutoryRuleViewSet, basename="payroll-statutory-rule"
)
router.register("payroll/pay-groups", config.PayGroupViewSet, basename="payroll-pay-group")

# People (PAY-003, PAY-004/005) and employee self-service
router.register("payroll/employees", people.PayrollEmployeeViewSet, basename="payroll-employee")
router.register(
    "payroll/compensations", people.CompensationViewSet, basename="payroll-compensation"
)
router.register("payroll/my", people.MyPayrollViewSet, basename="payroll-my")
router.register("payroll/loans", outputs.LoanViewSet, basename="payroll-loan")

# Monthly processing (PAY-006..017)
router.register("payroll/periods", processing.PeriodViewSet, basename="payroll-period")
router.register("payroll/runs", processing.RunViewSet, basename="payroll-run")
router.register("payroll/results", processing.ResultViewSet, basename="payroll-result")
router.register("payroll/exceptions", processing.ExceptionViewSet, basename="payroll-exception")

# Outputs, reports, audit (PAY-018..020)
router.register("payroll/payslips", outputs.PayslipViewSet, basename="payroll-payslip")
router.register("payroll/outputs", outputs.OutputViewSet, basename="payroll-output")
router.register("payroll/reports", outputs.ReportViewSet, basename="payroll-report")
router.register("payroll/audit", outputs.AuditViewSet, basename="payroll-audit")
router.register("payroll/dashboard", outputs.DashboardViewSet, basename="payroll-dashboard")
router.register("payroll/meta", outputs.MetaViewSet, basename="payroll-meta")

urlpatterns = router.urls
