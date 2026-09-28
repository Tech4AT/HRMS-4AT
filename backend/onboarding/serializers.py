import secrets
import string
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from accounts.models import ROLE_EMPLOYEE, Role
from core.scope import is_finance, is_hr_admin
from employees import identity_numbers
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
    next_employee_code,
)

from .models import (
    EMPLOYMENT_TYPE_CHOICES,
    OFFER_LETTER_PLACEHOLDERS,
    BackgroundVerification,
    OfferLetter,
    OfferLetterTemplate,
    OnboardingProfile,
    OnboardingTask,
    OnboardingTaskTemplate,
)
from .services import create_offer_letter

User = get_user_model()


def _generate_temporary_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


class OnboardingTaskTemplateSerializer(serializers.ModelSerializer):
    # Explicit `default=`: DRF's auto-generated BooleanField silently treats
    # a field missing from the request as False (an HTML-checkbox-form
    # convention), not the model's `default=True` — the frontend never sends
    # `isActive` on create, so without this every new template was being
    # created already soft-deleted (invisible in the `is_active=True` list).
    is_required = serializers.BooleanField(default=True)
    requires_document = serializers.BooleanField(default=False)
    is_active = serializers.BooleanField(default=True)
    assignee_id = serializers.PrimaryKeyRelatedField(
        source='assignee', queryset=Employee.objects.all(), required=False, allow_null=True,
    )
    assignee = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingTaskTemplate
        fields = [
            'id', 'category', 'title', 'description', 'owner', 'is_required',
            'requires_document', 'offset_days', 'sort_order', 'is_active', 'assignee_id', 'assignee',
        ]

    def get_assignee(self, obj):
        return _person(obj.assignee)


def _person(employee):
    if employee is None:
        return None
    return {'id': employee.id, 'name': employee.full_name, 'work_email': employee.work_email}


class OnboardingTaskSerializer(serializers.ModelSerializer):
    profile_id = serializers.IntegerField(source='profile.id', read_only=True)
    assignee = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingTask
        fields = [
            'id', 'profile_id', 'category', 'title', 'description', 'owner',
            'is_required', 'requires_document', 'due_date', 'status',
            'sort_order', 'completed_at', 'assignee',
        ]
        read_only_fields = ['completed_at']

    def get_assignee(self, obj):
        return _person(obj.assignee)


class OnboardingTaskCreateSerializer(serializers.ModelSerializer):
    # See OnboardingTaskTemplateSerializer above for why these need an
    # explicit `default=` (DRF's BooleanField quirk, not the model's own).
    is_required = serializers.BooleanField(default=True)
    requires_document = serializers.BooleanField(default=False)
    assignee_id = serializers.PrimaryKeyRelatedField(
        source='assignee', queryset=Employee.objects.all(), required=False, allow_null=True,
    )

    class Meta:
        model = OnboardingTask
        fields = ['category', 'title', 'description', 'owner', 'is_required', 'requires_document', 'due_date', 'sort_order', 'assignee_id']


class OnboardingTaskStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[c for c, _ in OnboardingTask._meta.get_field('status').choices])


class EmployeeSummarySerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='full_name', read_only=True)
    department_id = serializers.IntegerField(source='department.id', read_only=True, default=None)
    designation_id = serializers.IntegerField(source='designation.id', read_only=True, default=None)

    class Meta:
        model = Employee
        fields = ['id', 'name', 'work_email', 'personal_email', 'employee_code', 'department_id', 'designation_id']


class OfferLetterTemplateSerializer(serializers.ModelSerializer):
    placeholders = serializers.SerializerMethodField()
    source_docx_name = serializers.SerializerMethodField()
    source_docx_url = serializers.SerializerMethodField()
    # Explicit `default=`: DRF's auto-generated BooleanField silently defaults
    # missing input to False (an HTML-checkbox-form convention), NOT the
    # model's `default=True` — without this, every template created via the
    # API (as opposed to the ORM directly) came back soft-deleted.
    is_default = serializers.BooleanField(default=False)
    is_active = serializers.BooleanField(default=True)

    class Meta:
        model = OfferLetterTemplate
        fields = [
            'id', 'name', 'heading', 'body', 'is_default', 'is_active', 'placeholders',
            'source_docx_name', 'source_docx_url',
        ]

    def get_placeholders(self, obj):
        return OFFER_LETTER_PLACEHOLDERS

    def get_source_docx_name(self, obj):
        return obj.source_docx.name.rsplit('/', 1)[-1] if obj.source_docx else None

    def get_source_docx_url(self, obj):
        if not obj.source_docx:
            return None
        request = self.context.get('request')
        try:
            url = obj.source_docx.url
        except ValueError:
            return None
        return request.build_absolute_uri(url) if request else url


class OfferLetterSerializer(serializers.ModelSerializer):
    document_url = serializers.SerializerMethodField()
    employment_type_display = serializers.CharField(source='get_employment_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    rejection_reason_display = serializers.CharField(source='get_rejection_reason_display', read_only=True, default=None)
    template_id = serializers.IntegerField(source='template.id', read_only=True, default=None)
    template_name = serializers.CharField(source='template.name', read_only=True, default=None)

    class Meta:
        model = OfferLetter
        fields = [
            'id', 'offer_number', 'version', 'is_current', 'basic_salary', 'hra', 'other_allowances',
            'other_components', 'annual_ctc', 'currency', 'employment_type', 'employment_type_display',
            'probation_period_months', 'notice_period_days', 'status', 'status_display', 'document_url',
            'template_id', 'template_name', 'generated_at', 'sent_at', 'viewed_at', 'expires_at',
            'signed_at', 'accepted_at', 'rejected_at', 'cancelled_at', 'signature_name',
            'rejection_reason', 'rejection_reason_display', 'rejection_comments',
        ]
        read_only_fields = ['annual_ctc']

    def get_document_url(self, obj):
        # The protected, access-logged file route (see DocumentSerializer) —
        # MEDIA_URL isn't served at all, so a raw `file.url` link just 404s.
        if not obj.document or not obj.document.file:
            return None
        return f'/api/documents/{obj.document.id}/file'


class BankDetailsSerializer(serializers.ModelSerializer):
    """Same masking convention as `documents/access.py`'s salary gate: full
    `account_number` is only ever included when the caller explicitly asked
    to see it (self-service, or HR/finance passing `?reveal=true` — see
    BankDetailsDetailView) — everyone else gets `account_number_masked`
    only. Controlled via `context['mask']`, not a second serializer, so the
    two representations can never drift out of sync on the other fields."""

    account_number_masked = serializers.CharField(source='masked_account_number', read_only=True)

    class Meta:
        model = BankDetails
        fields = [
            'id', 'account_holder_name', 'account_number', 'account_number_masked',
            'ifsc_code', 'bank_name', 'branch_name', 'updated_at',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('mask'):
            data.pop('account_number', None)
        return data


class BankDetailsWriteSerializer(serializers.Serializer):
    account_holder_name = serializers.CharField(max_length=200)
    account_number = serializers.CharField(max_length=34, min_length=4)
    ifsc_code = serializers.CharField(max_length=11, required=False, allow_blank=True)
    bank_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    branch_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_account_number(self, value):
        value = value.strip().replace(' ', '')
        if not value.isalnum():
            raise serializers.ValidationError('Account number should contain only letters and numbers.')
        return value

    def validate_ifsc_code(self, value):
        return value.strip().upper()


class IdentityDocumentSerializer(serializers.ModelSerializer):
    """Same masking convention as BankDetailsSerializer — `document_number`
    is only included unmasked for the candidate's own self-service view, or
    an HR/finance view fetched with `?reveal=true` (see
    IdentityDocumentsDetailView)."""

    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    document_number_masked = serializers.CharField(source='masked_document_number', read_only=True)
    verification_status_display = serializers.CharField(source='get_verification_status_display', read_only=True)
    verified_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    file_download_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = IdentityDocument
        fields = [
            'id', 'document_type', 'document_type_display', 'document_number', 'document_number_masked',
            'full_name', 'date_of_birth', 'address', 'gender', 'parent_or_guardian_name',
            'file_url', 'file_download_url', 'file_name', 'file_size', 'expiry_date', 'is_expired',
            'verification_status', 'verification_status_display', 'verification_notes',
            'verified_by_name', 'verified_at', 'submitted_by_name', 'created_at', 'updated_at',
        ]

    def get_verified_by_name(self, obj):
        if not obj.verified_by:
            return None
        name = f'{obj.verified_by.first_name} {obj.verified_by.last_name}'.strip()
        return name or obj.verified_by.email

    def get_submitted_by_name(self, obj):
        if not obj.submitted_by:
            return None
        name = f'{obj.submitted_by.first_name} {obj.submitted_by.last_name}'.strip()
        return name or obj.submitted_by.email

    def _linked_file(self, obj):
        from documents.models import Document

        return Document.objects.filter(entity_type='identity_document', entity_id=str(obj.id)).order_by('-uploaded_at').first()

    def get_file_url(self, obj):
        # Same protected-endpoint convention as documents.DocumentSerializer
        # (see its docstring) — never the raw storage path.
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file' if doc and doc.file else None

    def get_file_download_url(self, obj):
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file?mode=download' if doc and doc.file else None

    def get_file_name(self, obj):
        doc = self._linked_file(obj)
        return doc.original_filename if doc else None

    def get_file_size(self, obj):
        doc = self._linked_file(obj)
        if not doc:
            return None
        try:
            return doc.file.size
        except (ValueError, OSError):
            return None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('mask'):
            data.pop('document_number', None)
        return data


class IdentityDocumentWriteSerializer(serializers.Serializer):
    document_type = serializers.ChoiceField(choices=IdentityDocument.TYPE_CHOICES)
    document_number = serializers.CharField(max_length=64)
    full_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    expiry_date = serializers.DateField(required=False, allow_null=True)
    address = serializers.CharField(required=False, allow_blank=True)
    gender = serializers.CharField(max_length=20, required=False, allow_blank=True)
    parent_or_guardian_name = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, attrs):
        # On an edit (partial) the type isn't resent — it comes from the
        # existing record via context.
        doc_type = attrs.get('document_type') or self.context.get('document_type')
        if 'document_number' in attrs:
            number, error = identity_numbers.validate(doc_type, attrs['document_number'])
            if error:
                raise serializers.ValidationError({'document_number': error})
            attrs['document_number'] = number
        return attrs


class IdentityDocumentVerifySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[IdentityDocument.VERIFICATION_VERIFIED, IdentityDocument.VERIFICATION_REJECTED])
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        # A rejection with no explanation leaves the candidate unable to fix
        # anything — the one piece of this action that can't be a human call
        # made silently.
        if attrs['status'] == IdentityDocument.VERIFICATION_REJECTED and not attrs.get('notes', '').strip():
            raise serializers.ValidationError({'notes': 'A reason is required when rejecting a document.'})
        return attrs


class EducationRecordSerializer(serializers.ModelSerializer):
    verification_status_display = serializers.CharField(source='get_verification_status_display', read_only=True)
    verified_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    file_download_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = EducationRecord
        fields = [
            'id', 'degree', 'branch', 'university', 'year_of_joining', 'year_of_completion', 'grade',
            'file_url', 'file_download_url', 'file_name', 'file_size',
            'verification_status', 'verification_status_display', 'verification_notes',
            'verified_by_name', 'verified_at', 'submitted_by_name', 'created_at', 'updated_at',
        ]

    def get_verified_by_name(self, obj):
        if not obj.verified_by:
            return None
        name = f'{obj.verified_by.first_name} {obj.verified_by.last_name}'.strip()
        return name or obj.verified_by.email

    def get_submitted_by_name(self, obj):
        if not obj.submitted_by:
            return None
        name = f'{obj.submitted_by.first_name} {obj.submitted_by.last_name}'.strip()
        return name or obj.submitted_by.email

    def _linked_file(self, obj):
        from documents.models import Document

        return Document.objects.filter(entity_type='education_record', entity_id=str(obj.id)).order_by('-uploaded_at').first()

    def get_file_url(self, obj):
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file' if doc and doc.file else None

    def get_file_download_url(self, obj):
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file?mode=download' if doc and doc.file else None

    def get_file_name(self, obj):
        doc = self._linked_file(obj)
        return doc.original_filename if doc else None

    def get_file_size(self, obj):
        doc = self._linked_file(obj)
        if not doc:
            return None
        try:
            return doc.file.size
        except (ValueError, OSError):
            return None


class EducationRecordWriteSerializer(serializers.Serializer):
    degree = serializers.CharField(max_length=150)
    branch = serializers.CharField(max_length=150, required=False, allow_blank=True)
    university = serializers.CharField(max_length=200)
    year_of_joining = serializers.IntegerField(required=False, allow_null=True, min_value=1950, max_value=2100)
    year_of_completion = serializers.IntegerField(min_value=1950, max_value=2100)
    grade = serializers.CharField(max_length=20)

    def validate_degree(self, value):
        return value.strip()

    def validate_university(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('College / university is required.')
        return value

    def validate_grade(self, value):
        """CGPA (e.g. 8.5) or percentage (e.g. 73 / 73%) — stored as the
        bare number."""
        raw = value.strip().rstrip('%').strip()
        try:
            number = float(raw)
        except ValueError:
            raise serializers.ValidationError('Enter your CGPA (e.g. 8.5) or percentage (e.g. 73).')
        if not 0 < number <= 100:
            raise serializers.ValidationError('CGPA / percentage must be between 0 and 100.')
        return raw

    def validate(self, attrs):
        # On an edit (partial) the other year may only exist on the record.
        instance = self.context.get('instance')
        joining = attrs.get('year_of_joining', getattr(instance, 'year_of_joining', None))
        completion = attrs.get('year_of_completion', getattr(instance, 'year_of_completion', None))
        if joining and completion and completion < joining:
            raise serializers.ValidationError({'year_of_completion': 'Year of completion cannot be before the year of joining.'})
        return attrs


class EducationRecordVerifySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[EducationRecord.VERIFICATION_VERIFIED, EducationRecord.VERIFICATION_REJECTED])
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs['status'] == EducationRecord.VERIFICATION_REJECTED and not attrs.get('notes', '').strip():
            raise serializers.ValidationError({'notes': 'A reason is required when rejecting a document.'})
        return attrs


class EmployeeLetterSerializer(serializers.ModelSerializer):
    letter_type_display = serializers.CharField(source='get_letter_type_display', read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    file_download_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeLetter
        fields = [
            'id', 'letter_type', 'letter_type_display', 'title', 'issued_date',
            'file_url', 'file_download_url', 'file_name', 'uploaded_by_name', 'created_at',
        ]

    def get_uploaded_by_name(self, obj):
        if not obj.uploaded_by:
            return None
        name = f'{obj.uploaded_by.first_name} {obj.uploaded_by.last_name}'.strip()
        return name or obj.uploaded_by.email

    def _linked_file(self, obj):
        from documents.models import Document

        return Document.objects.filter(entity_type='employee_letter', entity_id=str(obj.id)).order_by('-uploaded_at').first()

    def get_file_url(self, obj):
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file' if doc and doc.file else None

    def get_file_download_url(self, obj):
        doc = self._linked_file(obj)
        return f'/api/documents/{doc.id}/file?mode=download' if doc and doc.file else None

    def get_file_name(self, obj):
        doc = self._linked_file(obj)
        return doc.original_filename if doc else None


class EmployeeLetterWriteSerializer(serializers.Serializer):
    letter_type = serializers.ChoiceField(choices=EmployeeLetter.TYPE_CHOICES)
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    issued_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        if not attrs.get('title'):
            attrs['title'] = dict(EmployeeLetter.TYPE_CHOICES)[attrs['letter_type']]
        return attrs


class BackgroundVerificationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    reviewed_by_name = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()
    documents_submitted = serializers.SerializerMethodField()

    class Meta:
        model = BackgroundVerification
        fields = [
            'id', 'status', 'status_display', 'notes', 'ready_at',
            'reviewed_by_name', 'reviewed_at', 'document_count', 'documents_submitted',
        ]
        read_only_fields = ['status_display', 'ready_at', 'reviewed_by_name', 'reviewed_at']

    def get_reviewed_by_name(self, obj):
        # accounts.User has no get_full_name() (it's AbstractBaseUser, not
        # AbstractUser) — build the display name from first/last directly.
        if not obj.reviewed_by:
            return None
        name = f'{obj.reviewed_by.first_name} {obj.reviewed_by.last_name}'.strip()
        return name or obj.reviewed_by.email

    def _doc_tasks(self, obj):
        return [t for t in obj.profile.tasks.all() if t.requires_document]

    def get_document_count(self, obj):
        return len(self._doc_tasks(obj))

    def get_documents_submitted(self, obj):
        return sum(1 for t in self._doc_tasks(obj) if t.status == 'done')


def _background_verification_for(obj, context):
    """HR-only, same audience as the BackgroundVerificationDetailView — a
    manager viewing this onboarding record shouldn't see verification
    status any more than they'd see the offer letter."""
    request = context.get('request')
    user = getattr(request, 'user', None) if request else None
    if user is None or not is_hr_admin(user):
        return None
    try:
        bgv = obj.background_verification
    except BackgroundVerification.DoesNotExist:
        return None
    return BackgroundVerificationSerializer(bgv, context=context).data


def _offer_letter_for(obj, context):
    """Salary is sensitive (docs/REQUIREMENTS.md security baseline) — only
    hr_admin, finance, and the employee themselves ever see it, regardless of
    whether the caller can otherwise view this onboarding record (a manager
    can view the record, but not the package)."""
    request = context.get('request')
    user = getattr(request, 'user', None) if request else None
    if user is None:
        return None
    employee = getattr(user, 'employee', None)
    allowed = is_hr_admin(user) or is_finance(user) or (employee and employee.id == obj.employee_id)
    if not allowed:
        return None
    offer = obj.current_offer_letter
    if offer is None:
        return None
    return OfferLetterSerializer(offer, context=context).data


class OnboardingProfileSerializer(serializers.ModelSerializer):
    employee = EmployeeSummarySerializer(read_only=True)
    buddy = EmployeeSummarySerializer(read_only=True)
    joining_date = serializers.DateField(source='employee.joining_date', read_only=True)
    employee_status = serializers.CharField(source='employee.status', read_only=True)
    tasks = OnboardingTaskSerializer(many=True, read_only=True)
    progress = serializers.SerializerMethodField()
    offer_letter = serializers.SerializerMethodField()
    background_verification = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingProfile
        fields = [
            'id', 'employee', 'buddy', 'stage', 'joining_date', 'employee_status',
            'day1_completed_at', 'completed_at', 'created_at', 'tasks', 'progress', 'offer_letter',
            'background_verification',
        ]

    def get_progress(self, obj):
        tasks = list(obj.tasks.all())
        required = [t for t in tasks if t.is_required]
        if not required:
            return {'completed': 0, 'total': 0, 'percent': 100}
        done = sum(1 for t in required if t.status == 'done')
        percent = round(done / len(required) * 100)
        return {'completed': done, 'total': len(required), 'percent': percent}

    def get_offer_letter(self, obj):
        return _offer_letter_for(obj, self.context)

    def get_background_verification(self, obj):
        return _background_verification_for(obj, self.context)


class OnboardingProfileListSerializer(serializers.ModelSerializer):
    employee = EmployeeSummarySerializer(read_only=True)
    joining_date = serializers.DateField(source='employee.joining_date', read_only=True)
    employee_status = serializers.CharField(source='employee.status', read_only=True)
    progress = serializers.SerializerMethodField()
    offer_letter = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingProfile
        fields = ['id', 'employee', 'stage', 'joining_date', 'employee_status', 'progress', 'offer_letter']

    def get_progress(self, obj):
        tasks = list(obj.tasks.all())
        required = [t for t in tasks if t.is_required]
        if not required:
            return {'completed': 0, 'total': 0, 'percent': 100}
        done = sum(1 for t in required if t.status == 'done')
        return {'completed': done, 'total': len(required), 'percent': round(done / len(required) * 100)}

    def get_offer_letter(self, obj):
        return _offer_letter_for(obj, self.context)


class CreateNewHireSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    work_email = serializers.EmailField()
    # Mandatory: this is the only contact address that reaches the candidate
    # before their work account exists (welcome email, offer letter, Day-1
    # instructions all go here in preference to work_email — see services.py).
    personal_email = serializers.EmailField()
    phone = serializers.CharField(required=False, allow_blank=True, default='')
    department_id = serializers.PrimaryKeyRelatedField(
        source='department', queryset=Department.objects.filter(is_active=True), required=False, allow_null=True
    )
    designation_id = serializers.PrimaryKeyRelatedField(
        source='designation', queryset=Designation.objects.filter(is_active=True), required=False, allow_null=True
    )
    manager_id = serializers.PrimaryKeyRelatedField(source='manager', queryset=Employee.objects.all(), required=False, allow_null=True)
    dotted_line_manager_id = serializers.PrimaryKeyRelatedField(source='dotted_line_manager', queryset=Employee.objects.all(), required=False, allow_null=True)
    buddy_id = serializers.PrimaryKeyRelatedField(source='buddy', queryset=Employee.objects.all(), required=False, allow_null=True)
    location_id = serializers.PrimaryKeyRelatedField(source='location', queryset=Location.objects.filter(is_active=True), required=False, allow_null=True)
    legal_entity_id = serializers.PrimaryKeyRelatedField(source='legal_entity', queryset=LegalEntity.objects.filter(is_active=True), required=False, allow_null=True)
    business_unit_id = serializers.PrimaryKeyRelatedField(source='business_unit', queryset=BusinessUnit.objects.filter(is_active=True), required=False, allow_null=True)
    cost_center_id = serializers.PrimaryKeyRelatedField(source='cost_center', queryset=CostCenter.objects.filter(is_active=True), required=False, allow_null=True)
    joining_date = serializers.DateField()
    temporary_password = serializers.CharField(required=False, allow_blank=True, default='')

    # The salary structure — annual figures; Total CTC is always their sum,
    # never entered directly (see OfferLetter.save()). Generates the draft
    # offer letter immediately; see onboarding/services.py::create_offer_letter.
    # Sensitive (salary) — this endpoint is already HR-Admin-only at the view level.
    basic_salary = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'), default=Decimal('0'))
    hra = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'), default=Decimal('0'))
    other_allowances = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'), default=Decimal('0'))
    other_components = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'), default=Decimal('0'))
    currency = serializers.CharField(required=False, max_length=3, default='INR')
    employment_type = serializers.ChoiceField(choices=EMPLOYMENT_TYPE_CHOICES, required=False, default='full_time')
    probation_period_months = serializers.IntegerField(required=False, min_value=0, max_value=24, default=3)
    notice_period_days = serializers.IntegerField(required=False, min_value=0, max_value=365, default=30)
    offer_letter_template_id = serializers.PrimaryKeyRelatedField(
        source='offer_letter_template', queryset=OfferLetterTemplate.objects.filter(is_active=True),
        required=False, allow_null=True,
    )

    def validate_work_email(self, value):
        value = value.lower()
        if Employee.objects.filter(work_email__iexact=value).exists() or User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate(self, attrs):
        total = attrs.get('basic_salary', 0) + attrs.get('hra', 0) + attrs.get('other_allowances', 0) + attrs.get('other_components', 0)
        if total <= 0:
            raise serializers.ValidationError({'basic_salary': 'Enter a salary — at least one component must be greater than 0.'})
        return attrs

    @transaction.atomic
    def save(self, created_by):
        data = self.validated_data
        role, _ = Role.objects.get_or_create(name=ROLE_EMPLOYEE, defaults={'permissions': []})

        user = User.objects.create_user(
            email=data['work_email'],
            password=data.get('temporary_password') or _generate_temporary_password(),
            first_name=data['first_name'],
            last_name=data['last_name'],
            role=role,
        )

        employee = Employee.objects.create(
            user=user,
            employee_code=next_employee_code(),
            first_name=data['first_name'],
            last_name=data['last_name'],
            work_email=data['work_email'],
            personal_email=data['personal_email'],
            phone=data.get('phone', ''),
            department=data.get('department'),
            designation=data.get('designation'),
            manager=data.get('manager'),
            location=data.get('location'),
            legal_entity=data.get('legal_entity'),
            business_unit=data.get('business_unit'),
            cost_center=data.get('cost_center'),
            status=Employee.STATUS_PRE_ONBOARDING,
            joining_date=data['joining_date'],
        )

        profile = OnboardingProfile.objects.create(
            employee=employee,
            buddy=data.get('buddy'),
            stage='preboarding',
            created_by=created_by,
        )

        # Preboarding tasks are NOT generated here. Creating a new hire is
        # not the same as the candidate accepting an offer — the checklist,
        # the welcome email, and Employee activation all wait for
        # services.accept_offer(), triggered only once the candidate signs
        # through their secure offer link. Employee.status stays
        # `pre_onboarding` (an "offer pending" gate, not "onboarding in
        # progress") until then.
        try:
            create_offer_letter(
                profile,
                basic_salary=data.get('basic_salary') or 0,
                hra=data.get('hra') or 0,
                other_allowances=data.get('other_allowances') or 0,
                other_components=data.get('other_components') or 0,
                currency=data.get('currency') or 'INR',
                employment_type=data.get('employment_type') or 'full_time',
                probation_period_months=data.get('probation_period_months') or 3,
                notice_period_days=data.get('notice_period_days') or 30,
                created_by=created_by,
                template=data.get('offer_letter_template'),
            )
        except ValueError as exc:
            raise serializers.ValidationError({'offer_letter_template_id': [str(exc)]}) from exc

        return profile
