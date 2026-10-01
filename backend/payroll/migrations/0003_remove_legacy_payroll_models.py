"""Remove the pre-PRD payroll models, replaced by the PRD v1.0 data model in
0004. Written as plain DeleteModel operations in dependency order (models that
reference others first) so it applies cleanly on SQLite and Postgres."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("payroll", "0002_lopconfiguration_payrolladjustment_payrollperiod_and_more"),
    ]

    operations = [
        migrations.DeleteModel(name="EmployeeVariablePay"),
        migrations.DeleteModel(name="EmployeePayrollStatus"),
        migrations.DeleteModel(name="PayrollOvertimeAdjustment"),
        migrations.DeleteModel(name="PayrollAdjustment"),
        migrations.DeleteModel(name="PayrollResult"),
        migrations.DeleteModel(name="PayrollRun"),
        migrations.DeleteModel(name="PayrollPeriod"),
        migrations.DeleteModel(name="LopConfiguration"),
        migrations.DeleteModel(name="PfRule"),
        migrations.DeleteModel(name="PtSlab"),
        migrations.DeleteModel(name="TdsConfiguration"),
        migrations.DeleteModel(name="PayGroup"),
        migrations.DeleteModel(name="EmployeeCompensation"),
        migrations.DeleteModel(name="SalaryStructureComponent"),
        migrations.DeleteModel(name="SalaryStructure"),
        migrations.DeleteModel(name="SalaryComponent"),
    ]
