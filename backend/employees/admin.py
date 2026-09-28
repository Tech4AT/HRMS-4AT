from django.contrib import admin

from employees.models import (
    BankDetails,
    BusinessUnit,
    CostCenter,
    Department,
    Designation,
    EducationRecord,
    Employee,
    EmployeeLetter,
    IdentityDocument,
    LegalEntity,
    Location,
    Resignation,
)

admin.site.register(Location)
admin.site.register(LegalEntity)
admin.site.register(BusinessUnit)
admin.site.register(CostCenter)


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active"]


@admin.register(Designation)
class DesignationAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active"]


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ["employee_code", "first_name", "last_name", "work_email", "status"]
    search_fields = ["employee_code", "first_name", "last_name", "work_email", "user__email"]
    list_filter = ["status", "department", "location", "legal_entity", "business_unit"]


@admin.register(BankDetails)
class BankDetailsAdmin(admin.ModelAdmin):
    list_display = ["employee"]


@admin.register(IdentityDocument)
class IdentityDocumentAdmin(admin.ModelAdmin):
    list_display = ["employee", "document_type", "verification_status"]
    list_filter = ["document_type", "verification_status"]


@admin.register(EducationRecord)
class EducationRecordAdmin(admin.ModelAdmin):
    list_display = ["employee", "degree", "verification_status"]
    list_filter = ["verification_status"]


@admin.register(EmployeeLetter)
class EmployeeLetterAdmin(admin.ModelAdmin):
    list_display = ["employee", "letter_type", "title", "issued_date"]
    list_filter = ["letter_type"]


@admin.register(Resignation)
class ResignationAdmin(admin.ModelAdmin):
    list_display = ("employee", "status", "requested_last_day", "last_working_day", "initiated_by_hr", "created_at")
    list_filter = ("status", "initiated_by_hr")
