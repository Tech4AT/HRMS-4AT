"""Read-only Django admin views of payroll data. All changes go through the
API services so they are validated, versioned and audited."""

from django.contrib import admin

from . import models as m


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(m.SalaryComponent)
class SalaryComponentAdmin(ReadOnlyAdmin):
    list_display = ("code", "name", "component_type", "calculation_type", "status", "version")
    list_filter = ("component_type", "status")
    search_fields = ("code", "name")


@admin.register(m.SalaryStructure)
class SalaryStructureAdmin(ReadOnlyAdmin):
    list_display = ("code", "name", "status", "version", "effective_from")


@admin.register(m.PayGroup)
class PayGroupAdmin(ReadOnlyAdmin):
    list_display = ("code", "name", "legal_entity", "proration_basis")


@admin.register(m.PayrollPeriod)
class PayrollPeriodAdmin(ReadOnlyAdmin):
    list_display = ("pay_group", "year", "month", "status")


@admin.register(m.PayrollRun)
class PayrollRunAdmin(ReadOnlyAdmin):
    list_display = ("period", "run_no", "status", "net_total", "error_count", "warning_count")


@admin.register(m.StatutoryRule)
class StatutoryRuleAdmin(ReadOnlyAdmin):
    list_display = ("code", "state", "effective_from", "status", "is_reviewed")
