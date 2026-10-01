"""Seed payroll configuration, and optionally demo people, for development and UAT.

    python manage.py seed_payroll            # components, structure, pay group, statutory rules
    python manage.py seed_payroll --demo     # + demo employees and one login per payroll role

Statutory rules are seeded as ILLUSTRATIVE placeholders with is_reviewed=False:
they are not legal advice and must be reviewed by the payroll/compliance owner
before production use (PRD §16). Idempotent: existing codes are left alone.
--demo refuses to run unless DEBUG is on."""

import datetime

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, User
from employees.models import Department, Designation, Employee, LegalEntity, Location
from payroll import models as m
from payroll.services import config as config_service
from payroll.services import people as people_service

START = datetime.date(2026, 4, 1)

COMPONENTS = [
    # code, name, type, category, calc, value, extra
    (
        "BASIC",
        "Basic",
        "earning",
        "fixed",
        "percent_of_ctc",
        "45",
        dict(
            include_in_pf_wage=True,
            include_in_esi_wage=True,
            display_order=1,
            description="Fixed basic pay. Used for PF, ESI and statutory calculations.",
        ),
    ),
    (
        "HRA",
        "HRA",
        "earning",
        "fixed",
        "percent_of_component",
        "50",
        dict(base_component_code="BASIC", include_in_esi_wage=True, display_order=2),
    ),
    (
        "SPECIAL",
        "Special Allowance",
        "earning",
        "fixed",
        "balancing",
        None,
        dict(include_in_esi_wage=True, display_order=3),
    ),
    (
        "PERF_BONUS",
        "Performance Bonus",
        "earning",
        "variable",
        "percent_of_ctc",
        "10",
        dict(is_proratable=True, display_order=4),
    ),
    (
        "OVERTIME",
        "Overtime",
        "earning",
        "variable",
        "units_rate",
        "300",
        dict(part_of_ctc=False, is_proratable=False, is_lop_applicable=False, display_order=5),
    ),
    (
        "REIMB_TAX",
        "Reimbursement (Taxable)",
        "earning",
        "reimbursement",
        "actual",
        None,
        dict(part_of_ctc=False, is_proratable=False, is_lop_applicable=False, display_order=6),
    ),
    (
        "REIMB_NONTAX",
        "Reimbursement (Non-Taxable)",
        "earning",
        "reimbursement",
        "actual",
        None,
        dict(
            is_taxable=False,
            part_of_ctc=False,
            part_of_gross=False,
            is_proratable=False,
            is_lop_applicable=False,
            display_order=7,
        ),
    ),
    (
        "OTHER_EARN",
        "Other Earnings",
        "earning",
        "variable",
        "actual",
        None,
        dict(part_of_ctc=False, is_proratable=False, is_lop_applicable=False, display_order=8),
    ),
    (
        "BONUS",
        "Bonus / Incentive",
        "earning",
        "variable",
        "actual",
        None,
        dict(part_of_ctc=False, is_proratable=False, is_lop_applicable=False, display_order=9),
    ),
    (
        "ARREARS",
        "Arrears",
        "earning",
        "variable",
        "actual",
        None,
        dict(part_of_ctc=False, is_proratable=False, is_lop_applicable=False, display_order=10),
    ),
    (
        "PF_EE",
        "PF (Employee)",
        "deduction",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="PF_EMPLOYEE", display_order=20),
    ),
    (
        "ESI_EE",
        "ESI (Employee)",
        "deduction",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="ESI_EMPLOYEE", display_order=21, rounding="round_up"),
    ),
    (
        "PT",
        "Professional Tax",
        "deduction",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="PT", display_order=22),
    ),
    (
        "TDS",
        "TDS",
        "deduction",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="TDS", display_order=23),
    ),
    (
        "LOAN",
        "Other Deductions (Loan)",
        "deduction",
        "loan",
        "actual",
        None,
        dict(display_order=24),
    ),
    (
        "OTHER_DED",
        "Other Deductions",
        "deduction",
        "variable",
        "actual",
        None,
        dict(display_order=25),
    ),
    (
        "PF_ER",
        "PF (Employer)",
        "employer_contribution",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="PF_EMPLOYER", display_order=30),
    ),
    (
        "ESI_ER",
        "ESI (Employer)",
        "employer_contribution",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="ESI_EMPLOYER", display_order=31, rounding="round_up"),
    ),
    (
        "GRATUITY",
        "Gratuity",
        "employer_contribution",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="GRATUITY", display_order=32),
    ),
    (
        "LWF_ER",
        "LWF (Employer)",
        "employer_contribution",
        "statutory",
        "rule_based",
        None,
        dict(statutory_rule_code="LWF_EMPLOYER", display_order=33, part_of_ctc=False),
    ),
]

RULES = [
    (
        "PF_EMPLOYEE",
        "PF employee (illustrative)",
        "",
        {"rate_pct": 12, "wage_ceiling": 15000, "apply_ceiling": False},
    ),
    (
        "PF_EMPLOYER",
        "PF employer (illustrative)",
        "",
        {"rate_pct": 12, "wage_ceiling": 15000, "apply_ceiling": False},
    ),
    (
        "ESI_EMPLOYEE",
        "ESI employee (illustrative)",
        "",
        {"rate_pct": 0.75, "eligibility_gross_limit": 21000, "rounding": "round_up"},
    ),
    (
        "ESI_EMPLOYER",
        "ESI employer (illustrative)",
        "",
        {"rate_pct": 3.25, "eligibility_gross_limit": 21000, "rounding": "round_up"},
    ),
    (
        "PT",
        "Professional Tax - Telangana (illustrative)",
        "Telangana",
        {
            "slabs": [
                {"from": 0, "to": 15000, "amount": 0},
                {"from": 15000.01, "to": 20000, "amount": 150},
                {"from": 20000.01, "to": None, "amount": 200},
            ]
        },
    ),
    (
        "PT",
        "Professional Tax - Karnataka (illustrative)",
        "Karnataka",
        {
            "slabs": [
                {"from": 0, "to": 24999, "amount": 0},
                {"from": 25000, "to": None, "amount": 200},
            ],
            "month_overrides": {"2": 300},
        },
    ),
    ("LWF_EMPLOYER", "LWF employer (illustrative)", "", {"amount": 40, "months": [6, 12]}),
    ("TDS", "TDS placeholder (manual entry in MVP)", "", {"method": "manual"}),
    (
        "GRATUITY",
        "Gratuity provision (illustrative)",
        "",
        {"rate_pct": 4.81, "base_component": "BASIC"},
    ),
]

STRUCTURE_LINES = [
    "BASIC",
    "HRA",
    "SPECIAL",
    "PERF_BONUS",
    "OVERTIME",
    "REIMB_TAX",
    "REIMB_NONTAX",
    "BONUS",
    "ARREARS",
    "OTHER_EARN",
    "PF_EE",
    "ESI_EE",
    "PT",
    "TDS",
    "LOAN",
    "OTHER_DED",
    "PF_ER",
    "ESI_ER",
    "GRATUITY",
]

DEMO_USERS = [
    ("payroll.admin@demo.4at", "Bhavana", "Reddy", "Payroll Admin"),
    ("finance.reviewer@demo.4at", "Ravi", "Kumar", "Finance Reviewer"),
    ("payroll.approver@demo.4at", "Prudvi", "Raju", "Payroll Approver"),
    ("auditor@demo.4at", "Asha", "Auditor", "Auditor"),
    ("hr.admin@demo.4at", "Priya", "Sharma", "HR Admin"),
]

DEMO_EMPLOYEES = [
    # code, first, last, dept, doj, ctc, esi, lwd
    ("4AT-001", "Nandini", "Reddy", "HR", "2024-04-01", 900000, False, None),
    ("4AT-002", "Nikhil", "Kommineni", "Engineering", "2024-04-01", 1200000, False, None),
    ("4AT-003", "Vishnu", "Pradhan", "Engineering", "2025-01-15", 744000, False, None),
    ("4AT-004", "Tejas", "P", "Engineering", "2023-10-01", 648000, False, "2026-09-18"),
    ("4AT-005", "Rohan", "Mehta", "Finance", "2022-06-01", 1080000, False, None),
    ("4AT-006", "Payal", "Vaishnav", "Academy", "2026-09-12", 240000, True, None),
    ("4AT-007", "Akhil", "Varma", "BD", "2021-08-01", 1020000, False, None),
    ("4AT-008", "Bhargavi", "S", "Engineering", "2025-07-01", 900000, False, None),
]


class Command(BaseCommand):
    help = "Seed payroll configuration (and --demo people) for development/UAT."

    def add_arguments(self, parser):
        parser.add_argument(
            "--demo", action="store_true", help="Also create demo employees and role logins."
        )
        parser.add_argument(
            "--password", default="Payroll@Demo1", help="Password for the demo logins."
        )

    @transaction.atomic
    def handle(self, *args, **options):
        actor = User.objects.filter(is_superuser=True).first()
        entity = LegalEntity.objects.order_by("id").first() or LegalEntity.objects.create(
            name="4AT Consulting LLP"
        )
        group, created = m.PayGroup.objects.get_or_create(
            code="MONTHLY-IN",
            defaults={
                "name": "Monthly - India",
                "legal_entity": entity,
                "proration_basis": "calendar_days",
                "approval_stages": ["finance_review", "final_approval"],
            },
        )
        self.stdout.write(f"Pay group: {group.name} ({'created' if created else 'exists'})")

        for code, name, state, params in RULES:
            if not m.StatutoryRule.objects.filter(code=code, state=state).exists():
                m.StatutoryRule.objects.create(
                    code=code,
                    name=name,
                    state=state,
                    params=params,
                    effective_from=START,
                    notes="Illustrative placeholder: review before production use.",
                )
        self.stdout.write(
            f"Statutory rules: {m.StatutoryRule.objects.count()} (NOT compliance-reviewed)"
        )

        for code, name, kind, category, calc, value, extra in COMPONENTS:
            if m.SalaryComponent.objects.filter(code=code).exists():
                continue
            data = {
                "code": code,
                "name": name,
                "payslip_label": name,
                "component_type": kind,
                "category": category,
                "calculation_type": calc,
                "value": value,
                "effective_from": START,
                "status": "active",
                **extra,
            }
            config_service.create_component(data, actor)
        self.stdout.write(f"Components: {m.SalaryComponent.objects.count()}")

        if not m.SalaryStructure.objects.filter(code="GS-IND-001").exists():
            config_service.create_structure(
                {
                    "code": "GS-IND-001",
                    "name": "General Structure - India",
                    "legal_entity": entity,
                    "pay_group": group,
                    "description": "Standard structure for full-time employees",
                    "effective_from": START,
                    "reference_ctc": 1200000,
                    "status": "active",
                    "lines": [
                        {"component_code": c, "order": i + 1} for i, c in enumerate(STRUCTURE_LINES)
                    ],
                },
                actor,
            )
        self.stdout.write("Structure: GS-IND-001 General Structure - India (active)")

        if options["demo"]:
            if not settings.DEBUG:
                raise CommandError(
                    "--demo only runs with DEBUG=True (never against production data)."
                )
            self._demo(entity, group, actor, options["password"])

    def _demo(self, entity, group, actor, password):
        location, _ = Location.objects.get_or_create(name="Hyderabad")
        structure = m.SalaryStructure.objects.get(code="GS-IND-001")
        # Every login is an employee in this HRMS: the scope resolver works from
        # the caller's own Employee record. The payroll team get no payroll
        # profile, so they are not part of the demo payroll population.
        for index, (email, first, last, role_name) in enumerate(DEMO_USERS, start=1):
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(
                    username=email.split("@")[0],
                    email=email,
                    password=password,
                    first_name=first,
                    last_name=last,
                )
                user.roles.add(Role.objects.get(name=role_name))
            if not Employee.objects.filter(user=user).exists():
                department, _ = Department.objects.get_or_create(name="Corporate")
                Employee.objects.create(
                    user=user,
                    employee_code=f"4AT-9{index:02d}",
                    department=department,
                    location=location,
                    legal_entity=entity,
                    date_of_joining=datetime.date(2022, 1, 1),
                )
            self.stdout.write(f"  login {email} / {password}  ({role_name})")
        for code, first, last, dept, doj, ctc, esi, lwd in DEMO_EMPLOYEES:
            if Employee.objects.filter(employee_code=code).exists():
                continue
            email = f"{first.lower()}.{last.lower()}@demo.4at"
            user = User.objects.create_user(
                username=code.lower(),
                email=email,
                password=password,
                first_name=first,
                last_name=last,
            )
            user.roles.add(Role.objects.get(name="Employee"))
            department, _ = Department.objects.get_or_create(name=dept)
            designation, _ = Designation.objects.get_or_create(name="Consultant")
            employee = Employee.objects.create(
                user=user,
                employee_code=code,
                department=department,
                designation=designation,
                location=location,
                legal_entity=entity,
                date_of_joining=datetime.date.fromisoformat(doj),
                date_of_exit=datetime.date.fromisoformat(lwd) if lwd else None,
            )
            people_service.save_profile(
                employee,
                {
                    "pay_group": group,
                    "work_state": "Telangana",
                    "esi_applicable": esi,
                    "effective_from": employee.date_of_joining,
                },
                actor,
            )
            m.EmployeePaymentInfo.objects.create(
                employee=employee,
                payment_method="direct_deposit",
                bank_name="HDFC Bank",
                bank_account_number=f"50100{code[-3:]}123456",
                bank_ifsc_code="HDFC0001234",
                bank_account_holder_name=f"{first} {last}",
            )
            m.EmployeeStatutoryInfo.objects.create(
                employee=employee,
                pan_number=f"ABCDE{code[-3:]}0F"[:10],
                uan_number=f"1000{code[-3:]}00001",
            )
            effective = max(employee.date_of_joining, START)
            revision = people_service.create_revision(
                employee,
                {
                    "structure": structure,
                    "annual_ctc": ctc,
                    "effective_from": effective,
                    "revision_type": "new_assignment",
                    "reason": "Initial assignment (demo seed)",
                },
                actor,
            )
            people_service.apply_revision(revision, actor)
        self.stdout.write(
            f"Demo employees: {Employee.objects.filter(employee_code__startswith='4AT-').count()}"
        )
        self.stdout.write(
            (
                "  employees log in as <first>.<last>@demo.4at "
                f"/ {password}, e.g. nikhil.kommineni@demo.4at"
            )
        )
