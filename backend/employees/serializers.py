"""Two different contracts live in this file, deliberately:

- EmployeeSerializer / the NamedEntity serializers below match
  employees/page.tsx, org/page.tsx, and profile/page.tsx's actual Employee
  and NamedEntity TypeScript interfaces exactly — snake_case field names,
  string ids — verified by reading the frontend source directly, not
  assumed from docs. This is a deliberate, isolated exception to the
  project's general camelCase convention (correctly used everywhere else:
  auth, RBAC/accounts). See employees/views.py's FrontendEnvelopeMixin for
  the matching {success, data} response wrapping this requires.
- No salary/bank fields here either way — those land in Phase 2 gated to
  hr_admin/finance only (docs/TASKS.md P2-E1-01); this serializer only ever
  exposes what P1-E1-04's Employee model actually carries.
"""

from datetime import date

from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.models import Role
from core.enums import EmployeeStatus, EmploymentType, WorkMode
from employees.models import (
    AuthorizedSignatory,
    BusinessUnit,
    Band,
    CodeScheme,
    CostCenter,
    Department,
    Employee,
    Grade,
    HierarchyRule,
    JobFamily,
    JobTitle,
    LegalEntity,
    LegalEntityBankAccount,
    Level,
    Location,
    OrgSetting,
    PayGrade,
    Position,
    Team,
)

User = get_user_model()


class _NamedEntitySerializer(serializers.ModelSerializer):
    """{id, name} — matches frontend/src/app/(app)/*/page.tsx's NamedEntity
    interface exactly. `id` as a string, not DRF's default integer, since
    that's the interface's declared type."""

    id = serializers.SerializerMethodField()

    class Meta:
        fields = ["id", "name"]

    def get_id(self, obj):
        return str(obj.pk)


class DepartmentSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = Department


class JobTitleSerializer(_NamedEntitySerializer):
    """{id, name} read shape. Kept under the historic `designations` endpoint
    name as well, so existing clients keep working (see urls.py aliases)."""

    class Meta(_NamedEntitySerializer.Meta):
        model = JobTitle


# Historic name — the model is JobTitle now; the read field/endpoint names
# (`designation_id`, `/designations/`) are unchanged for API stability.
DesignationSerializer = JobTitleSerializer


class LocationSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = Location


class LegalEntitySerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = LegalEntity


class BusinessUnitSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = BusinessUnit


class CostCenterSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = CostCenter
        fields = ["id", "name", "code"]


class TeamSerializer(_NamedEntitySerializer):
    """{id, name, department_id, lead_id} — the read list shape for teams."""

    department_id = serializers.SerializerMethodField()
    lead_id = serializers.SerializerMethodField()

    class Meta(_NamedEntitySerializer.Meta):
        model = Team
        fields = ["id", "name", "department_id", "lead_id"]

    def get_department_id(self, obj):
        return str(obj.department_id) if obj.department_id else None

    def get_lead_id(self, obj):
        return str(obj.lead_id) if obj.lead_id else None


class JobFamilySerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = JobFamily


class LevelSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = Level


class GradeSerializer(_NamedEntitySerializer):
    class Meta(_NamedEntitySerializer.Meta):
        model = Grade


class PositionSerializer(serializers.ModelSerializer):
    """Read shape for positions: snake_case string ids, like EmployeeSerializer."""

    id = serializers.SerializerMethodField()
    department_id = serializers.SerializerMethodField()
    job_title_id = serializers.SerializerMethodField()
    level_id = serializers.SerializerMethodField()
    grade_id = serializers.SerializerMethodField()
    business_unit_id = serializers.SerializerMethodField()
    reports_to_id = serializers.SerializerMethodField()
    incumbent_id = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = [
            "id",
            "name",
            "department_id",
            "job_title_id",
            "level_id",
            "grade_id",
            "business_unit_id",
            "reports_to_id",
            "status",
            "incumbent_id",
            "is_active",
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_department_id(self, obj):
        return str(obj.department_id) if obj.department_id else None

    def get_job_title_id(self, obj):
        return str(obj.job_title_id) if obj.job_title_id else None

    def get_level_id(self, obj):
        return str(obj.level_id) if obj.level_id else None

    def get_grade_id(self, obj):
        return str(obj.grade_id) if obj.grade_id else None

    def get_business_unit_id(self, obj):
        return str(obj.business_unit_id) if obj.business_unit_id else None

    def get_reports_to_id(self, obj):
        return str(obj.reports_to_id) if obj.reports_to_id else None

    def get_incumbent_id(self, obj):
        return str(obj.incumbent_id) if obj.incumbent_id else None


class EmployeeSerializer(serializers.ModelSerializer):
    """Matches employees/page.tsx's `Employee` interface field-for-field:
    first_name/last_name (not full_name), work_email (not email), and
    *_id foreign keys as bare string ids (the page resolves names itself via
    separate department/designation/location NamedEntity lookups — see
    toNameMap in that file)."""

    id = serializers.SerializerMethodField()
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    work_email = serializers.EmailField(source="user.email", read_only=True)
    department_id = serializers.SerializerMethodField()
    designation_id = serializers.SerializerMethodField()
    location_id = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()
    legal_entity_id = serializers.SerializerMethodField()
    business_unit_id = serializers.SerializerMethodField()
    cost_center_id = serializers.SerializerMethodField()
    position_id = serializers.SerializerMethodField()
    level_id = serializers.SerializerMethodField()
    grade_id = serializers.SerializerMethodField()
    team_ids = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id",
            "employee_code",
            "first_name",
            "last_name",
            "work_email",
            "department_id",
            "designation_id",
            "location_id",
            "manager_id",
            "legal_entity_id",
            "business_unit_id",
            "cost_center_id",
            "position_id",
            "level_id",
            "grade_id",
            "team_ids",
            "status",
            "employment_type",
            "work_mode",
            "date_of_joining",
            "date_of_exit",
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_team_ids(self, obj):
        # Team membership is M2M (Employee.teams); the org chart/structure use
        # this to show which teams a person belongs to.
        return [str(t) for t in obj.teams.values_list("pk", flat=True)]

    def get_department_id(self, obj):
        return str(obj.department_id) if obj.department_id else None

    def get_designation_id(self, obj):
        return str(obj.designation_id) if obj.designation_id else None

    def get_location_id(self, obj):
        return str(obj.location_id) if obj.location_id else None

    def get_manager_id(self, obj):
        return str(obj.manager_id) if obj.manager_id else None

    def get_legal_entity_id(self, obj):
        return str(obj.legal_entity_id) if obj.legal_entity_id else None

    def get_business_unit_id(self, obj):
        return str(obj.business_unit_id) if obj.business_unit_id else None

    def get_cost_center_id(self, obj):
        return str(obj.cost_center_id) if obj.cost_center_id else None

    def get_position_id(self, obj):
        return str(obj.position_id) if obj.position_id else None

    def get_level_id(self, obj):
        return str(obj.level_id) if obj.level_id else None

    def get_grade_id(self, obj):
        return str(obj.grade_id) if obj.grade_id else None


def _reference(model, source):
    return serializers.PrimaryKeyRelatedField(
        source=source, queryset=model.objects.all(), required=False, allow_null=True
    )


class EmployeeWriteSerializer(serializers.Serializer):
    """Input for creating and editing an employee (PATCH is partial).

    Deliberately has no role field: assigning a role is `roles.manage`, a
    different privilege from `employees.write`, so a directory editor cannot
    promote anyone. New accounts get the default Employee role and an unusable
    password (no login until a password is set through the reset flow)."""

    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    work_email = serializers.EmailField()
    employee_code = serializers.CharField(max_length=50)
    status = serializers.ChoiceField(choices=EmployeeStatus.choices, required=False)
    department_id = _reference(Department, "department")
    designation_id = _reference(JobTitle, "designation")
    location_id = _reference(Location, "location")
    legal_entity_id = _reference(LegalEntity, "legal_entity")
    manager_id = _reference(Employee, "manager")
    business_unit_id = _reference(BusinessUnit, "business_unit")
    cost_center_id = _reference(CostCenter, "cost_center")
    position_id = _reference(Position, "position")
    level_id = _reference(Level, "level")
    grade_id = _reference(Grade, "grade")
    employment_type = serializers.ChoiceField(choices=EmploymentType.choices, required=False)
    work_mode = serializers.ChoiceField(choices=WorkMode.choices, required=False)
    date_of_joining = serializers.DateField(required=False, allow_null=True)
    date_of_exit = serializers.DateField(required=False, allow_null=True)
    exit_reason = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate_work_email(self, value):
        taken = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.user_id)
        if taken.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_employee_code(self, value):
        taken = Employee.objects.filter(employee_code=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("This employee code is already in use.")
        return value

    def validate(self, attrs):
        manager = attrs.get("manager")
        if manager is not None and self.instance is not None:
            self._reject_reporting_cycle(self.instance, manager)
        current = self.instance
        joined = (
            attrs["date_of_joining"]
            if "date_of_joining" in attrs
            else getattr(current, "date_of_joining", None)
        )
        left = (
            attrs["date_of_exit"]
            if "date_of_exit" in attrs
            else getattr(current, "date_of_exit", None)
        )
        status = attrs.get("status", getattr(current, "status", EmployeeStatus.ACTIVE))
        if joined and left and left < joined:
            raise serializers.ValidationError(
                {"date_of_exit": "The exit date cannot be before the joining date."}
            )
        if attrs.get("date_of_exit") and status != EmployeeStatus.EXITED:
            raise serializers.ValidationError(
                {"date_of_exit": "An exit date only applies to someone who has left."}
            )
        self._reject_hierarchy_violations(attrs)
        return attrs

    @staticmethod
    def _reject_reporting_cycle(employee, new_manager):
        """A manager change must not make someone (transitively) their own boss."""
        if new_manager.pk == employee.pk:
            raise serializers.ValidationError(
                {"manager_id": "An employee cannot be their own manager."}
            )
        seen, cursor = set(), new_manager
        while cursor is not None and cursor.pk not in seen:
            if cursor.pk == employee.pk:
                raise serializers.ValidationError(
                    {"manager_id": "This would create a circular reporting line."}
                )
            seen.add(cursor.pk)
            cursor = cursor.manager

    def _reject_hierarchy_violations(self, attrs):
        """Enforce active HierarchyRules on an employee create/patch.

        Builds a lightweight candidate from the instance overlaid with the
        incoming attrs (ids only — validate_manager never touches the DB for
        the employee side) and rejects the write when a rule is violated.
        With no active rules this is a no-op, so existing flows are
        unaffected. The seed loader writes via objects.create (never this
        serializer), so booting with demo data cannot trip a rule."""
        from employees.models import validate_manager

        instance = self.instance
        manager = attrs.get("manager", getattr(instance, "manager", None))

        class _Candidate:
            pass

        candidate = _Candidate()
        for field in ("level_id", "designation_id", "department_id"):
            related = field[:-3]
            if related in attrs:
                ref = attrs[related]
                setattr(candidate, field, ref.pk if ref is not None else None)
            else:
                setattr(candidate, field, getattr(instance, field, None))
        candidate.manager = manager
        violations = validate_manager(candidate, manager)
        if violations:
            raise serializers.ValidationError({"manager_id": violations})

    def create(self, validated):
        email = validated["work_email"]
        user = User(
            username=email,
            email=email,
            first_name=validated["first_name"],
            last_name=validated.get("last_name", ""),
        )
        user.set_unusable_password()
        status = validated.get("status", EmployeeStatus.ACTIVE)
        user.is_active = status != EmployeeStatus.EXITED
        user.save()
        employee_role = Role.objects.filter(name="Employee").first()
        if employee_role is not None:
            user.roles.add(employee_role)
        exit_date = validated.get("date_of_exit")
        if status == EmployeeStatus.EXITED and exit_date is None:
            exit_date = date.today()
        return Employee.objects.create(
            user=user,
            employee_code=validated["employee_code"],
            status=status,
            employment_type=validated.get("employment_type", EmploymentType.FULL_TIME),
            work_mode=validated.get("work_mode", WorkMode.OFFICE),
            department=validated.get("department"),
            designation=validated.get("designation"),
            location=validated.get("location"),
            legal_entity=validated.get("legal_entity"),
            business_unit=validated.get("business_unit"),
            cost_center=validated.get("cost_center"),
            position=validated.get("position"),
            level=validated.get("level"),
            grade=validated.get("grade"),
            manager=validated.get("manager"),
            date_of_joining=validated.get("date_of_joining"),
            date_of_exit=exit_date,
            exit_reason=validated.get("exit_reason", ""),
        )

    def update(self, employee, validated):
        user = employee.user
        for field in ("first_name", "last_name"):
            if field in validated:
                setattr(user, field, validated[field])
        if "work_email" in validated:
            if user.username == user.email:
                user.username = validated["work_email"]
            user.email = validated["work_email"]
        user.save()
        for field in (
            "employee_code",
            "status",
            "department",
            "designation",
            "location",
            "legal_entity",
            "business_unit",
            "cost_center",
            "position",
            "level",
            "grade",
            "manager",
            "employment_type",
            "work_mode",
            "date_of_joining",
            "date_of_exit",
            "exit_reason",
        ):
            if field in validated:
                setattr(employee, field, validated[field])
        employee.save()
        return employee


GENDER_CHOICES = [
    ("female", "Female"),
    ("male", "Male"),
    ("other", "Other"),
    ("prefer_not_to_say", "Prefer not to say"),
]


class PersonalSerializer(serializers.ModelSerializer):
    """Personal details, held back from the ordinary directory. Read with
    employees.personal.read, changed with employees.personal.write."""

    gender = serializers.ChoiceField(choices=GENDER_CHOICES, required=False, allow_blank=True)

    class Meta:
        model = Employee
        fields = ["personal_email", "phone", "dob", "gender", "exit_reason"]
        extra_kwargs = {
            "personal_email": {"required": False},
            "phone": {"required": False},
            "dob": {"required": False, "allow_null": True},
            "exit_reason": {"required": False},
        }

    def validate_dob(self, value):
        if value and value > date.today():
            raise serializers.ValidationError("Date of birth cannot be in the future.")
        return value


class EssProfileSerializer(serializers.ModelSerializer):
    """A person's own profile, in the shape the frontend's profile and
    organisation pages read (snake_case, string ids)."""

    id = serializers.SerializerMethodField()
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    work_email = serializers.EmailField(source="user.email", read_only=True)
    department_id = serializers.SerializerMethodField()
    designation_id = serializers.SerializerMethodField()
    location_id = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id",
            "employee_code",
            "first_name",
            "last_name",
            "work_email",
            "personal_email",
            "phone",
            "dob",
            "gender",
            "department_id",
            "designation_id",
            "location_id",
            "date_of_joining",
            "status",
            "manager_id",
        ]

    def get_id(self, obj):
        return str(obj.pk)

    def get_department_id(self, obj):
        return str(obj.department_id) if obj.department_id else None

    def get_designation_id(self, obj):
        return str(obj.designation_id) if obj.designation_id else None

    def get_location_id(self, obj):
        return str(obj.location_id) if obj.location_id else None

    def get_manager_id(self, obj):
        return str(obj.manager_id) if obj.manager_id else None


class EssProfileWriteSerializer(PersonalSerializer):
    """What a person may change about themselves: contact details, date of
    birth and gender. Nothing about their job, manager or status."""

    class Meta(PersonalSerializer.Meta):
        fields = ["personal_email", "phone", "dob", "gender"]


# ---- organisation structure management (camelCase, paginated, org.manage) ----


class _OrgUnitSerializer(serializers.ModelSerializer):
    employee_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        fields = ["id", "name", "code", "description", "is_active", "employee_count", "created_at"]
        read_only_fields = ["id", "employee_count", "created_at"]


def _org_serializer(model, extra_fields=(), extra_read_only=(), **declared):
    meta = type(
        "Meta",
        (_OrgUnitSerializer.Meta,),
        {
            "model": model,
            "fields": [*_OrgUnitSerializer.Meta.fields, *extra_fields],
            "read_only_fields": [*_OrgUnitSerializer.Meta.read_only_fields, *extra_read_only],
        },
    )
    name = f"{model.__name__}AdminSerializer"
    return type(name, (_OrgUnitSerializer,), {"Meta": meta, **declared})


def _person_name(employee):
    """Display name for an Employee FK: full name, falling back to code."""
    if employee is None:
        return None
    user = getattr(employee, "user", None)
    if user is None:
        return employee.employee_code
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.get_username()


class _DepartmentAdmin(_OrgUnitSerializer):
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)
    child_count = serializers.IntegerField(read_only=True, default=0)
    head_name = serializers.SerializerMethodField()
    cost_center_name = serializers.CharField(
        source="cost_center.name", read_only=True, default=None
    )
    business_unit_name = serializers.CharField(
        source="business_unit.name", read_only=True, default=None
    )

    class Meta(_OrgUnitSerializer.Meta):
        model = Department
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "parent",
            "parent_name",
            "child_count",
            "head",
            "head_name",
            "cost_center",
            "cost_center_name",
            "business_unit",
            "business_unit_name",
            "email_alias",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "parent_name",
            "child_count",
            "head_name",
            "cost_center_name",
            "business_unit_name",
        ]

    def get_head_name(self, obj):
        return _person_name(getattr(obj, "head", None))

    def validate(self, attrs):
        parent = attrs.get("parent")
        if parent is not None and self.instance is not None:
            if parent.pk == self.instance.pk:
                raise serializers.ValidationError(
                    {"parent": "A department cannot be under itself."}
                )
            cursor, seen = parent, set()
            while cursor is not None and cursor.pk not in seen:
                if cursor.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        {"parent": "A department cannot sit under its own sub-department."}
                    )
                seen.add(cursor.pk)
                cursor = cursor.parent
        return attrs


DepartmentAdminSerializer = _DepartmentAdmin


class JobTitleAdminSerializer(_OrgUnitSerializer):
    job_family_name = serializers.CharField(
        source="job_family.name", read_only=True, default=None
    )
    level_name = serializers.CharField(source="level.name", read_only=True, default=None)

    class Meta(_OrgUnitSerializer.Meta):
        model = JobTitle
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "job_family",
            "job_family_name",
            "level",
            "level_name",
            "is_people_manager",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "job_family_name",
            "level_name",
        ]


# Historic name — the model is JobTitle now; `/org/designations/` stays
# registered as an alias of `/org/job-titles/` (see urls.py).
DesignationAdminSerializer = JobTitleAdminSerializer


class LocationAdminSerializer(_OrgUnitSerializer):
    location_head_name = serializers.SerializerMethodField()

    class Meta(_OrgUnitSerializer.Meta):
        model = Location
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "address_line1",
            "address_line2",
            "city",
            "state",
            "country",
            "postal_code",
            "timezone",
            "latitude",
            "longitude",
            "type",
            "location_head",
            "location_head_name",
            "email_alias",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "location_head_name",
        ]

    def get_location_head_name(self, obj):
        return _person_name(getattr(obj, "location_head", None))


class LegalEntityAdminSerializer(_OrgUnitSerializer):
    registered_address_name = serializers.CharField(
        source="registered_address.name", read_only=True, default=None
    )

    class Meta(_OrgUnitSerializer.Meta):
        model = LegalEntity
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "legal_name",
            "company_identification_number",
            "date_of_incorporation",
            "type_of_business",
            "sector",
            "nature_of_business",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "zip_code",
            "financial_year",
            "registered_address",
            "registered_address_name",
            "country",
            "currency",
            "logo",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "registered_address_name",
        ]


class BusinessUnitAdminSerializer(_OrgUnitSerializer):
    legal_entity_name = serializers.CharField(
        source="legal_entity.name", read_only=True, default=None
    )
    head_name = serializers.SerializerMethodField()
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)
    child_count = serializers.IntegerField(read_only=True, default=0)

    class Meta(_OrgUnitSerializer.Meta):
        model = BusinessUnit
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "legal_entity",
            "legal_entity_name",
            "head",
            "head_name",
            "parent",
            "parent_name",
            "child_count",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "legal_entity_name",
            "head_name",
            "parent_name",
            "child_count",
        ]

    def get_head_name(self, obj):
        return _person_name(getattr(obj, "head", None))

    def validate(self, attrs):
        parent = attrs.get("parent")
        if parent is not None and self.instance is not None:
            if parent.pk == self.instance.pk:
                raise serializers.ValidationError(
                    {"parent": "A business unit cannot be under itself."}
                )
            cursor, seen = parent, set()
            while cursor is not None and cursor.pk not in seen:
                if cursor.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        {"parent": "A business unit cannot sit under its own division."}
                    )
                seen.add(cursor.pk)
                cursor = cursor.parent
        return attrs


class CostCenterAdminSerializer(_OrgUnitSerializer):
    owner_name = serializers.SerializerMethodField()
    legal_entity_name = serializers.CharField(
        source="legal_entity.name", read_only=True, default=None
    )

    class Meta(_OrgUnitSerializer.Meta):
        model = CostCenter
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "owner",
            "owner_name",
            "legal_entity",
            "legal_entity_name",
            "email_alias",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "owner_name",
            "legal_entity_name",
        ]

    def get_owner_name(self, obj):
        return _person_name(getattr(obj, "owner", None))


class TeamAdminSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    lead_name = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "name",
            "code",
            "description",
            "is_active",
            "department",
            "department_name",
            "lead",
            "lead_name",
            "created_at",
        ]
        read_only_fields = ["id", "department_name", "lead_name", "created_at"]

    def get_lead_name(self, obj):
        lead = getattr(obj, "lead", None)
        if lead is None:
            return None
        user = getattr(lead, "user", None)
        if user is None:
            return lead.employee_code
        full = f"{user.first_name} {user.last_name}".strip()
        return full or user.get_username()


class _JobArchAdminSerializer(_OrgUnitSerializer):
    """Level/Grade admin rows also report how many approved seats point at them."""

    position_count = serializers.IntegerField(read_only=True, default=0)


class LevelAdminSerializer(_JobArchAdminSerializer):
    job_family_name = serializers.CharField(
        source="job_family.name", read_only=True, default=None
    )

    class Meta(_OrgUnitSerializer.Meta):
        model = Level
        fields = [
            *_OrgUnitSerializer.Meta.fields,
            "position_count",
            "rank",
            "job_family",
            "job_family_name",
        ]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "position_count",
            "job_family_name",
        ]


class GradeAdminSerializer(_JobArchAdminSerializer):
    level_name = serializers.CharField(source="level.name", read_only=True, default=None)

    class Meta(_OrgUnitSerializer.Meta):
        model = Grade
        fields = [*_OrgUnitSerializer.Meta.fields, "position_count", "level", "level_name"]
        read_only_fields = [
            *_OrgUnitSerializer.Meta.read_only_fields,
            "position_count",
            "level_name",
        ]


class JobFamilyAdminSerializer(serializers.ModelSerializer):
    """Job families group levels; deleting one with levels/titles fails."""

    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)

    class Meta:
        model = JobFamily
        fields = [
            "id",
            "name",
            "code",
            "description",
            "is_active",
            "parent",
            "parent_name",
            "created_at",
        ]
        read_only_fields = ["id", "parent_name", "created_at"]

    def validate(self, attrs):
        parent = attrs.get("parent")
        if parent is not None and self.instance is not None:
            if parent.pk == self.instance.pk:
                raise serializers.ValidationError(
                    {"parent": "A job family cannot be under itself."}
                )
            cursor, seen = parent, set()
            while cursor is not None and cursor.pk not in seen:
                if cursor.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        {"parent": "A job family cannot sit under its own child."}
                    )
                seen.add(cursor.pk)
                cursor = cursor.parent
        return attrs


class PositionAdminSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    job_title_name = serializers.CharField(source="job_title.name", read_only=True, default=None)
    level_name = serializers.CharField(source="level.name", read_only=True, default=None)
    grade_name = serializers.CharField(source="grade.name", read_only=True, default=None)
    business_unit_name = serializers.CharField(
        source="business_unit.name", read_only=True, default=None
    )
    reports_to_name = serializers.CharField(source="reports_to.name", read_only=True, default=None)
    incumbent_name = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = [
            "id",
            "name",
            "status",
            "is_active",
            "department",
            "department_name",
            "job_title",
            "job_title_name",
            "level",
            "level_name",
            "grade",
            "grade_name",
            "business_unit",
            "business_unit_name",
            "reports_to",
            "reports_to_name",
            "incumbent",
            "incumbent_name",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "department_name",
            "job_title_name",
            "level_name",
            "grade_name",
            "business_unit_name",
            "reports_to_name",
            "incumbent_name",
            "created_at",
        ]

    def get_incumbent_name(self, obj):
        incumbent = getattr(obj, "incumbent", None)
        if incumbent is None:
            return None
        user = getattr(incumbent, "user", None)
        if user is None:
            return incumbent.employee_code
        full = f"{user.first_name} {user.last_name}".strip()
        return full or user.get_username()

    def validate(self, attrs):
        reports_to = attrs.get("reports_to")
        if reports_to is not None and self.instance is not None:
            if reports_to.pk == self.instance.pk:
                raise serializers.ValidationError(
                    {"reports_to": "A position cannot report to itself."}
                )
            cursor, seen = reports_to, set()
            while cursor is not None and cursor.pk not in seen:
                if cursor.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        {"reports_to": "A position cannot report to its own subordinate."}
                    )
                seen.add(cursor.pk)
                cursor = cursor.reports_to
        return attrs


class OrgSettingSerializer(serializers.ModelSerializer):
    """Org configuration key/values. `value` is free-form JSON."""

    class Meta:
        model = OrgSetting
        fields = ["id", "key", "value", "category", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class CodeSchemeSerializer(serializers.ModelSerializer):
    """Code-generation schemes. `next_code_preview` shows the code the next
    next_code() call would emit, without advancing the counter."""

    next_code_preview = serializers.SerializerMethodField()

    class Meta:
        model = CodeScheme
        fields = [
            "id",
            "entity_type",
            "prefix",
            "padding",
            "next_seq",
            "separator",
            "is_active",
            "next_code_preview",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "next_code_preview", "created_at", "updated_at"]

    def get_next_code_preview(self, obj):
        return obj.render()


class HierarchyRuleSerializer(serializers.ModelSerializer):
    from_level_name = serializers.CharField(
        source="from_level.name", read_only=True, default=None
    )
    from_job_title_name = serializers.CharField(
        source="from_job_title.name", read_only=True, default=None
    )
    must_report_to_level_name = serializers.CharField(
        source="must_report_to_level.name", read_only=True, default=None
    )

    class Meta:
        model = HierarchyRule
        fields = [
            "id",
            "from_level",
            "from_level_name",
            "from_job_title",
            "from_job_title_name",
            "must_report_to_level",
            "must_report_to_level_name",
            "same_department",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "from_level_name",
            "from_job_title_name",
            "must_report_to_level_name",
            "created_at",
            "updated_at",
        ]


class AuthorizedSignatorySerializer(serializers.ModelSerializer):
    """One authorised signatory of a legal entity (Keka inner tab)."""

    legal_entity_name = serializers.CharField(
        source="legal_entity.name", read_only=True, default=None
    )

    class Meta:
        model = AuthorizedSignatory
        fields = [
            "id",
            "legal_entity",
            "legal_entity_name",
            "name",
            "designation",
            "email",
            "din_or_pan",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "legal_entity_name", "created_at", "updated_at"]


class LegalEntityBankAccountSerializer(serializers.ModelSerializer):
    """One company bank account of a legal entity (Keka "Bank Details" tab)."""

    legal_entity_name = serializers.CharField(
        source="legal_entity.name", read_only=True, default=None
    )

    class Meta:
        model = LegalEntityBankAccount
        fields = [
            "id",
            "legal_entity",
            "legal_entity_name",
            "bank_name",
            "account_number",
            "ifsc_code",
            "branch",
            "account_type",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "legal_entity_name", "created_at", "updated_at"]


class PayGradeSerializer(serializers.ModelSerializer):
    """EXAMPLE placeholder pay grade — see PayGrade model note."""

    class Meta:
        model = PayGrade
        fields = [
            "id",
            "name",
            "code",
            "description",
            "min_pay",
            "mid_pay",
            "max_pay",
            "currency",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class BandSerializer(serializers.ModelSerializer):
    """EXAMPLE placeholder band — see Band model note."""

    pay_grade_name = serializers.CharField(
        source="pay_grade.name", read_only=True, default=None
    )

    class Meta:
        model = Band
        fields = [
            "id",
            "name",
            "code",
            "description",
            "pay_grade",
            "pay_grade_name",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "pay_grade_name", "created_at", "updated_at"]
