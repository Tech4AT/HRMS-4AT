import os

from django.contrib.auth import get_user_model
from django.db import models as django_models
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import write_audit
from core.scope import is_finance, is_hr_admin, is_it_admin, visible_employee_ids
from documents.models import Document
from documents.serializers import DocumentSerializer
from documents.views import ALLOWED_DOCUMENT_EXTENSIONS, MAX_DOCUMENT_SIZE_BYTES
from employees.models import BankDetails, EducationRecord, Employee, EmployeeLetter, IdentityDocument

User = get_user_model()

from . import services
from .exceptions import OfferWorkflowError
from .models import (
    ACCESS_AREA_BANK_DETAILS,
    ACCESS_AREA_CHOICES,
    ACCESS_AREA_EDUCATION,
    ACCESS_AREA_IDENTITY_DOCUMENTS,
    OnboardingAccessGrant,
    has_access_grant,
    BGV_FAILED,
    BGV_PASSED,
    OFFER_DRAFT,
    OFFER_GENERATED,
    BackgroundVerification,
    OfferLetter,
    OfferLetterTemplate,
    OnboardingProfile,
    OnboardingTask,
    OnboardingTaskTemplate,
)
from .serializers import (
    BackgroundVerificationSerializer,
    BankDetailsSerializer,
    BankDetailsWriteSerializer,
    CreateNewHireSerializer,
    EducationRecordSerializer,
    EducationRecordVerifySerializer,
    EducationRecordWriteSerializer,
    EmployeeLetterSerializer,
    EmployeeLetterWriteSerializer,
    IdentityDocumentSerializer,
    IdentityDocumentVerifySerializer,
    IdentityDocumentWriteSerializer,
    OfferLetterSerializer,
    OfferLetterTemplateSerializer,
    OnboardingProfileListSerializer,
    OnboardingProfileSerializer,
    OnboardingTaskCreateSerializer,
    OnboardingTaskSerializer,
    OnboardingTaskStatusSerializer,
    OnboardingTaskTemplateSerializer,
)

PROFILE_QS = OnboardingProfile.objects.select_related(
    'employee', 'employee__department', 'employee__designation', 'buddy'
).prefetch_related(
    django_models.Prefetch('tasks', queryset=OnboardingTask.objects.select_related('assignee')),
    django_models.Prefetch(
        'offer_letters', queryset=OfferLetter.objects.filter(is_current=True), to_attr='_current_offer_letter_cache',
    ),
)


def _workflow_error_response(exc: OfferWorkflowError):
    return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)


def _forbidden(message='Not permitted'):
    return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': message}}, status=403)


def _visible_profiles(user):
    if is_hr_admin(user):
        return PROFILE_QS.all()
    return PROFILE_QS.filter(employee_id__in=visible_employee_ids(user))


def _can_view_record(user, profile) -> bool:
    return is_hr_admin(user) or profile.employee_id in visible_employee_ids(user)


def _task_actor_owner(user, profile) -> str | None:
    """Which `owner` value the caller may act as on this profile's tasks, if any."""
    employee = getattr(user, 'employee', None)
    if employee is None:
        return None
    if profile.employee_id == employee.id:
        return 'new_hire'
    if profile.buddy_id == employee.id:
        return 'buddy'
    if profile.employee.manager_id == employee.id:
        return 'manager'
    if is_it_admin(user):
        return 'it_admin'
    return None


class OnboardingRecordListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (is_hr_admin(request.user) or getattr(request.user, 'employee', None)):
            return _forbidden()
        profiles = _visible_profiles(request.user).order_by('-created_at')
        stage = request.query_params.get('stage')
        if stage:
            profiles = profiles.filter(stage=stage)
        ctx = {'request': request}
        return Response({'success': True, 'data': OnboardingProfileListSerializer(profiles, many=True, context=ctx).data})

    def post(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        serializer = CreateNewHireSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = serializer.save(created_by=request.user)

        write_audit(request.user, 'onboarding.record_created', 'onboarding_profile', profile.id, {
            'employeeId': profile.employee_id,
            'joiningDate': str(profile.employee.joining_date),
        })
        # No candidate email yet, and no "welcome aboard" checklist email —
        # the candidate doesn't know they exist until HR explicitly sends
        # the offer (OfferLetterSendView), and the welcome/checklist email
        # only makes sense once they've accepted it (services.accept_offer).
        return Response(
            {'success': True, 'data': OnboardingProfileSerializer(profile, context={'request': request}).data},
            status=201,
        )


class OnboardingRecordDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if not _can_view_record(request.user, profile):
            return None
        return profile

    def get(self, request, pk):
        profile = self._get(request, pk)
        if profile is None:
            return _forbidden()
        return Response({'success': True, 'data': OnboardingProfileSerializer(profile, context={'request': request}).data})

    def patch(self, request, pk):
        """Also handles correcting the candidate's work/personal email —
        the fix for a bad address entered at new-hire creation (the exact
        thing that's been bouncing real test mail). Editable regardless of
        stage: a typo can be worth fixing even after the offer's gone out,
        so the *next* send/resend reaches the right inbox."""
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        buddy_id = request.data.get('buddy_id', 'unset')
        if buddy_id != 'unset':
            profile.buddy = Employee.objects.filter(pk=buddy_id).first() if buddy_id else None
            profile.save(update_fields=['buddy'])

        employee = profile.employee
        updates = {}

        if 'work_email' in request.data:
            new_work_email = str(request.data['work_email'] or '').strip().lower()
            if not new_work_email:
                return Response(
                    {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Work email cannot be blank.'}},
                    status=400,
                )
            taken = (
                Employee.objects.filter(work_email__iexact=new_work_email).exclude(pk=employee.pk).exists()
                or User.objects.filter(email__iexact=new_work_email).exclude(pk=employee.user_id).exists()
            )
            if taken:
                return Response(
                    {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Another account already uses this email.'}},
                    status=400,
                )
            updates['work_email'] = new_work_email

        if 'personal_email' in request.data:
            updates['personal_email'] = str(request.data['personal_email'] or '').strip().lower()

        if updates:
            before = {'workEmail': employee.work_email, 'personalEmail': employee.personal_email}
            for field, value in updates.items():
                setattr(employee, field, value)
            employee.save(update_fields=list(updates.keys()))
            # The login account's email has to track work_email — they were
            # the same value at creation (CreateNewHireSerializer) and a
            # login-by-email would silently break if they drifted apart.
            if 'work_email' in updates and employee.user_id:
                employee.user.email = updates['work_email']
                employee.user.save(update_fields=['email'])
            write_audit(request.user, 'onboarding.candidate_email_updated', 'employee', employee.id, {
                'before': before, 'after': {'workEmail': employee.work_email, 'personalEmail': employee.personal_email},
            })

        return Response({'success': True, 'data': OnboardingProfileSerializer(profile, context={'request': request}).data})


class OnboardingRecordActivateView(APIView):
    """Marks Day 1: flips the employee active, seeds the onboarding-category
    checklist, and audits it — the write-side hook docs/README.md's conflicts
    section describes as the one surviving hire-side touchpoint from the
    original (out-of-scope) recruitment module."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if profile.stage != 'preboarding':
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': f'Record is already {profile.stage}'}},
                status=409,
            )
        offer = profile.current_offer_letter
        if offer is None or offer.status != 'accepted':
            return Response(
                {'success': False, 'error': {
                    'code': 'CONFLICT',
                    'message': 'The candidate must accept and sign their offer before Day 1 can be marked complete.',
                }},
                status=409,
            )

        services.activate_day1(profile, actor=request.user)

        return Response({'success': True, 'data': OnboardingProfileSerializer(profile, context={'request': request}).data})


class OnboardingRecordCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if profile.stage == 'completed':
            return Response({'success': False, 'error': {'code': 'CONFLICT', 'message': 'Already completed'}}, status=409)

        profile.stage = 'completed'
        profile.completed_at = timezone.now()
        profile.save(update_fields=['stage', 'completed_at'])

        write_audit(request.user, 'onboarding.completed', 'onboarding_profile', profile.id, {})
        return Response({'success': True, 'data': OnboardingProfileSerializer(profile, context={'request': request}).data})


class OnboardingRecordTasksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if not _can_view_record(request.user, profile):
            return _forbidden()
        return Response({'success': True, 'data': OnboardingTaskSerializer(profile.tasks.all(), many=True).data})

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        serializer = OnboardingTaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = serializer.save(profile=profile)
        write_audit(request.user, 'onboarding.task_added', 'onboarding_task', task.id, {'title': task.title})
        return Response({'success': True, 'data': OnboardingTaskSerializer(task).data}, status=201)


class OnboardingTaskDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        task = get_object_or_404(OnboardingTask.objects.select_related('profile', 'profile__employee', 'assignee'), pk=pk)
        profile = task.profile

        if 'assignee_id' in request.data and 'status' not in request.data:
            # HR (re)assigning the task to a named person.
            if not is_hr_admin(request.user):
                return _forbidden('Only HR Admin can assign tasks')
            assignee_id = request.data.get('assignee_id')
            assignee = get_object_or_404(Employee, pk=assignee_id) if assignee_id else None
            before_id = task.assignee_id
            task.assignee = assignee
            task.save(update_fields=['assignee'])
            write_audit(request.user, 'onboarding.task_assigned', 'onboarding_task', task.id, {
                'from': before_id, 'to': assignee.id if assignee else None,
            })
            if assignee and assignee.id != before_id:
                services.notify_task_assignee(task)
            return Response({'success': True, 'data': OnboardingTaskSerializer(task).data})

        actor_owner = _task_actor_owner(request.user, profile)
        me = getattr(request.user, 'employee', None)
        is_assignee = bool(me and task.assignee_id == me.id)
        if not is_hr_admin(request.user) and actor_owner != task.owner and not is_assignee:
            return _forbidden('You are not the owner of this task')

        serializer = OnboardingTaskStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']

        if not is_hr_admin(request.user) and new_status == 'skipped':
            return _forbidden('Only HR Admin can skip a task')

        before = task.status
        task.status = new_status
        if new_status == 'done':
            task.completed_at = timezone.now()
            task.completed_by = request.user
        else:
            task.completed_at = None
            task.completed_by = None
        task.save(update_fields=['status', 'completed_at', 'completed_by'])

        write_audit(request.user, 'onboarding.task_status_changed', 'onboarding_task', task.id, {'from': before, 'to': new_status})
        if task.requires_document:
            services.refresh_background_verification_status(profile, actor=request.user)
        if new_status in ('done', 'skipped'):
            services.maybe_auto_activate(profile, actor=request.user)
        return Response({'success': True, 'data': OnboardingTaskSerializer(task).data})

    def delete(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        task = get_object_or_404(OnboardingTask, pk=pk)
        task_id = task.id
        task.delete()
        write_audit(request.user, 'onboarding.task_removed', 'onboarding_task', task_id, {})
        return Response(status=204)


class MyOnboardingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return Response({'success': True, 'data': None})
        profile = PROFILE_QS.filter(employee=employee).first()
        if profile is None:
            return Response({'success': True, 'data': None})
        data = OnboardingProfileSerializer(profile, context={'request': request}).data
        data['my_owner_role'] = _task_actor_owner(request.user, profile)
        return Response({'success': True, 'data': data})


class MyBankDetailsView(APIView):
    """`GET/PUT /onboarding/me/bank-details` — the candidate's own salary
    account details, collected during preboarding. Self-service: never
    masked here, it's the candidate's own data. Submitting it auto-completes
    the matching "Add bank account details" checklist item (see
    services.auto_complete_task_by_title) the same way an upload does."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        bank = BankDetails.objects.filter(employee=employee).first()
        return Response({'success': True, 'data': BankDetailsSerializer(bank).data if bank else None})

    def put(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        serializer = BankDetailsWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        bank, created = BankDetails.objects.update_or_create(
            employee=employee, defaults={**serializer.validated_data, 'updated_by': request.user},
        )
        write_audit(
            request.user, 'onboarding.bank_details_added' if created else 'onboarding.bank_details_updated',
            'bank_details', bank.id, {'employeeId': employee.id},
        )

        profile = OnboardingProfile.objects.filter(employee=employee).first()
        if profile is not None:
            services.auto_complete_task_by_title(profile, 'Add bank account details', actor=request.user)

        return Response({'success': True, 'data': BankDetailsSerializer(bank).data})


class BankDetailsDetailView(APIView):
    """`GET /onboarding/records/{id}/bank-details?reveal=true` — HR/finance
    view of a specific record's bank details. Same audience as the offer
    letter's salary (hr_admin, finance; never a manager — see
    `_offer_letter_for` in serializers.py for the identical rule).
    Account number is masked unless `reveal=true` is explicitly passed;
    revealing it is its own audited action, not implied by merely viewing
    the record."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not (is_hr_admin(request.user) or is_finance(request.user) or has_access_grant(request.user, ACCESS_AREA_BANK_DETAILS)):
            return _forbidden()
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        bank = BankDetails.objects.filter(employee=profile.employee).first()
        if bank is None:
            return Response({'success': True, 'data': None})

        reveal = request.query_params.get('reveal') == 'true'
        if reveal:
            write_audit(request.user, 'onboarding.bank_details_revealed', 'bank_details', bank.id, {
                'employeeId': profile.employee_id,
            })
        data = BankDetailsSerializer(bank, context={'mask': not reveal}).data
        return Response({'success': True, 'data': data})


# The one checklist item this structured flow replaces — special-cased by
# title on both this app's frontend pages, same matching convention as
# BANK_DETAILS_TASK_TITLE there and auto_complete_task_by_title here.
IDENTITY_DOCS_TASK_TITLE = 'submit id proof'
EDUCATION_TASK_TITLE = 'submit educational certificates'


class MyIdentityDocumentsView(APIView):
    """`GET/POST /onboarding/me/identity-documents` — the candidate's own
    identity documents (Aadhaar/PAN/Voter ID/...). Never masked here, it's
    the candidate's own data. Each POST both creates the structured record
    and satisfies the "Submit ID proof" checklist item (see
    services.auto_complete_task_by_title) — matching how a plain document
    upload used to auto-enable "Mark as submitted", just with real fields
    behind it instead of only a file."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        docs = IdentityDocument.objects.filter(employee=employee)
        return Response({'success': True, 'data': IdentityDocumentSerializer(docs, many=True, context={'request': request}).data})

    def post(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        serializer = IdentityDocumentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        doc_type = serializer.validated_data['document_type']
        if doc_type != IdentityDocument.TYPE_OTHER and IdentityDocument.objects.filter(
            employee=employee, document_type=doc_type,
        ).exists():
            label = dict(IdentityDocument.TYPE_CHOICES)[doc_type]
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': f'You have already added your {label} — edit it instead.'}},
                status=409,
            )

        doc = IdentityDocument.objects.create(employee=employee, submitted_by=request.user, **serializer.validated_data)
        write_audit(request.user, 'onboarding.identity_document_added', 'identity_document', doc.id, {
            'employeeId': employee.id, 'documentType': doc.document_type,
        })

        profile = OnboardingProfile.objects.filter(employee=employee).first()
        if profile is not None:
            services.auto_complete_task_by_title(profile, IDENTITY_DOCS_TASK_TITLE, actor=request.user)

        return Response(
            {'success': True, 'data': IdentityDocumentSerializer(doc, context={'request': request}).data}, status=201,
        )


class MyIdentityDocumentDetailView(APIView):
    """`DELETE /onboarding/me/identity-documents/{id}` — the candidate
    correcting a mistaken entry, or clearing a rejected submission to try
    again (the resubmission step of the reject -> resubmit -> re-review
    cycle: there's no separate "edit" endpoint, just delete-and-re-add,
    same as a generic document's "replace"). Blocked only once *verified* —
    that's a decision on record HR made off the data as submitted; a
    rejected one is explicitly meant to be replaced."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        """Edit in place. Any edit puts the document back in HR's queue as
        pending — HR's earlier decision was about the data as it was."""
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        doc = get_object_or_404(IdentityDocument, pk=pk, employee=employee)
        if doc.verification_status == IdentityDocument.VERIFICATION_VERIFIED:
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': 'This document has already been verified by HR. Contact HR if it needs to change.'}},
                status=409,
            )
        data = {k: v for k, v in request.data.items() if k != 'document_type'}
        serializer = IdentityDocumentWriteSerializer(data=data, partial=True, context={'document_type': doc.document_type})
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(doc, field, value)
        doc.verification_status = IdentityDocument.VERIFICATION_PENDING
        doc.verified_by = None
        doc.verified_at = None
        doc.save()
        write_audit(request.user, 'onboarding.identity_document_edited', 'identity_document', doc.id, {
            'employeeId': employee.id, 'fields': sorted(serializer.validated_data),
        })
        return Response({'success': True, 'data': IdentityDocumentSerializer(doc, context={'request': request}).data})

    def delete(self, request, pk):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        doc = get_object_or_404(IdentityDocument, pk=pk, employee=employee)
        if doc.verification_status == IdentityDocument.VERIFICATION_VERIFIED:
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': 'This document has already been verified and can no longer be removed.'}},
                status=409,
            )
        write_audit(request.user, 'onboarding.identity_document_removed', 'identity_document', doc.id, {'employeeId': employee.id})
        doc.delete()
        return Response(status=204)


class MyEducationRecordsView(APIView):
    """`GET/POST /onboarding/me/education-records` — the candidate's own
    degrees/certificates. Unlike IdentityDocument, several are expected
    (school, undergrad, postgrad...) — nothing here limits it to one per
    employee. Each POST satisfies the "Submit educational certificates"
    checklist item, same convention as identity documents."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        records = EducationRecord.objects.filter(employee=employee)
        return Response({'success': True, 'data': EducationRecordSerializer(records, many=True, context={'request': request}).data})

    def post(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        serializer = EducationRecordWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        record = EducationRecord.objects.create(employee=employee, submitted_by=request.user, **serializer.validated_data)
        write_audit(request.user, 'onboarding.education_record_added', 'education_record', record.id, {
            'employeeId': employee.id, 'degree': record.degree,
        })

        profile = OnboardingProfile.objects.filter(employee=employee).first()
        if profile is not None:
            services.auto_complete_task_by_title(profile, EDUCATION_TASK_TITLE, actor=request.user)

        return Response(
            {'success': True, 'data': EducationRecordSerializer(record, context={'request': request}).data}, status=201,
        )


class MyEducationRecordDetailView(APIView):
    """`DELETE /onboarding/me/education-records/{id}` — same resubmission
    rule as identity documents: blocked only once verified."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        """Edit in place — same rule as identity documents: any edit sends
        it back to HR as pending; verified records are locked."""
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        record = get_object_or_404(EducationRecord, pk=pk, employee=employee)
        if record.verification_status == EducationRecord.VERIFICATION_VERIFIED:
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': 'This record has already been verified by HR. Contact HR if it needs to change.'}},
                status=409,
            )
        serializer = EducationRecordWriteSerializer(data=request.data, partial=True, context={'instance': record})
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(record, field, value)
        record.verification_status = EducationRecord.VERIFICATION_PENDING
        record.verified_by = None
        record.verified_at = None
        record.save()
        write_audit(request.user, 'onboarding.education_record_edited', 'education_record', record.id, {
            'employeeId': employee.id, 'fields': sorted(serializer.validated_data),
        })
        return Response({'success': True, 'data': EducationRecordSerializer(record, context={'request': request}).data})

    def delete(self, request, pk):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        record = get_object_or_404(EducationRecord, pk=pk, employee=employee)
        if record.verification_status == EducationRecord.VERIFICATION_VERIFIED:
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': 'This record has already been verified and can no longer be removed.'}},
                status=409,
            )
        write_audit(request.user, 'onboarding.education_record_removed', 'education_record', record.id, {'employeeId': employee.id})
        record.delete()
        return Response(status=204)


class MyEmployeeLettersView(APIView):
    """`GET /onboarding/me/employee-letters` — read-only for the employee;
    only HR uploads these (see EmployeeLettersDetailView)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()
        letters = EmployeeLetter.objects.filter(employee=employee)
        return Response({'success': True, 'data': EmployeeLetterSerializer(letters, many=True, context={'request': request}).data})


class MyDocumentsOverviewView(APIView):
    """`GET /onboarding/me/documents-overview` — the "My Documents" landing
    payload: Resume (generic file bucket), Degrees & Certificates (now
    `EducationRecord` rows — structured, like Identity Documents, one row
    per degree/certificate, each independently verifiable and each
    submission satisfying the "Submit educational certificates" checklist
    item via `services.auto_complete_task_by_title`), Previous Experience
    (still a generic file bucket — falls back to a per-employee entity_type
    when there's no matching onboarding task, so it works for employees who
    never went through preboarding), and Employee Letters split into the
    signed offer letter(s) (`offerLetters`, system-generated) and any
    HR-issued letters (`employeeLetters` — appointment/appraisal/promotion,
    see `EmployeeLetter`). The frontend uploads/deletes generic buckets
    directly against the `documents.Document` API using the entityType/
    entityId given here — this view itself is read-only.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _forbidden()

        profile = OnboardingProfile.objects.filter(employee=employee).order_by('-created_at').first()

        def bucket_payload(entity_type, entity_id):
            docs = Document.objects.filter(entity_type=entity_type, entity_id=entity_id)
            return {
                'entityType': entity_type,
                'entityId': entity_id,
                'documents': DocumentSerializer(docs, many=True, context={'request': request}).data,
            }

        exp_entity_type, exp_entity_id = services.resolve_document_folder_entity(
            profile, employee, 'Submit previous employment documents', 'employee_experience',
        )

        offers = OfferLetter.objects.filter(profile__employee=employee).order_by('-generated_at')
        offer_letters = []
        for offer in offers:
            # `offer.document` is always the CURRENT PDF — generate_offer_letter_document
            # re-renders and reassigns it every time the offer changes (a draft edit, then
            # again on signing), orphaning but not deleting the previous Document row. Only
            # the current one belongs in the candidate's folder — listing every historical
            # regeneration would show the same "Offer Letter" repeated once per edit.
            if offer.document_id is None:
                continue
            offer_letters.append({
                'offerId': offer.id,
                'offerNumber': offer.offer_number,
                'version': offer.version,
                'status': offer.status,
                'documents': DocumentSerializer([offer.document], many=True, context={'request': request}).data,
            })

        education_records = EducationRecord.objects.filter(employee=employee)
        employee_letters = EmployeeLetter.objects.filter(employee=employee)

        return Response({'success': True, 'data': {
            'employeeId': employee.id,
            'resume': bucket_payload('resume', str(employee.id)),
            'educationRecords': EducationRecordSerializer(education_records, many=True, context={'request': request}).data,
            'previousExperience': bucket_payload(exp_entity_type, exp_entity_id),
            'offerLetters': offer_letters,
            'employeeLetters': EmployeeLetterSerializer(employee_letters, many=True, context={'request': request}).data,
        }})


class IdentityDocumentsDetailView(APIView):
    """`GET /onboarding/records/{id}/identity-documents?reveal=true` —
    HR/finance view of a record's identity documents. Same audience and
    same explicit-reveal-is-audited rule as BankDetailsDetailView."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not (is_hr_admin(request.user) or is_finance(request.user) or has_access_grant(request.user, ACCESS_AREA_IDENTITY_DOCUMENTS)):
            return _forbidden()
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        docs = IdentityDocument.objects.filter(employee=profile.employee)

        reveal = request.query_params.get('reveal') == 'true'
        if reveal and docs:
            write_audit(request.user, 'onboarding.identity_documents_revealed', 'employee', profile.employee_id, {})
        data = IdentityDocumentSerializer(docs, many=True, context={'request': request, 'mask': not reveal}).data
        return Response({'success': True, 'data': data})


class IdentityDocumentVerifyView(APIView):
    """`PATCH /onboarding/identity-documents/{id}/verify` `{status, notes?}`
    — HR Admin's verify/reject decision. Same "this judgment can't be
    automated" reasoning as BackgroundVerificationDetailView — only a human
    call, never inferred from the data itself."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        doc = get_object_or_404(IdentityDocument, pk=pk)
        serializer = IdentityDocumentVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        doc.verification_status = serializer.validated_data['status']
        doc.verification_notes = serializer.validated_data.get('notes', '')
        doc.verified_by = request.user
        doc.verified_at = timezone.now()
        doc.save(update_fields=['verification_status', 'verification_notes', 'verified_by', 'verified_at'])

        write_audit(request.user, 'onboarding.identity_document_verified', 'identity_document', doc.id, {
            'employeeId': doc.employee_id, 'status': doc.verification_status,
        })
        return Response({'success': True, 'data': IdentityDocumentSerializer(doc, context={'request': request}).data})


class EducationRecordsDetailView(APIView):
    """`GET /onboarding/records/{id}/education-records` — HR/finance/manager
    view of a record's degrees & certificates. No masking (not sensitive
    PII like an identity number), so unlike identity documents there's no
    reveal gate — same audience as a manager already has for onboarding-task
    documents."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if not (_can_view_record(request.user, profile) or has_access_grant(request.user, ACCESS_AREA_EDUCATION)):
            return _forbidden()
        records = EducationRecord.objects.filter(employee=profile.employee)
        return Response({'success': True, 'data': EducationRecordSerializer(records, many=True, context={'request': request}).data})


class EducationRecordVerifyView(APIView):
    """`PATCH /onboarding/education-records/{id}/verify` `{status, notes?}`
    — HR Admin's verify/reject decision, same pattern as identity documents."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        record = get_object_or_404(EducationRecord, pk=pk)
        serializer = EducationRecordVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        record.verification_status = serializer.validated_data['status']
        record.verification_notes = serializer.validated_data.get('notes', '')
        record.verified_by = request.user
        record.verified_at = timezone.now()
        record.save(update_fields=['verification_status', 'verification_notes', 'verified_by', 'verified_at'])

        write_audit(request.user, 'onboarding.education_record_verified', 'education_record', record.id, {
            'employeeId': record.employee_id, 'status': record.verification_status,
        })
        return Response({'success': True, 'data': EducationRecordSerializer(record, context={'request': request}).data})


class EmployeeLettersDetailView(APIView):
    """`GET/POST /onboarding/records/{id}/employee-letters` — HR issuing
    (or listing) letters beyond the offer letter: appointment, appraisal,
    promotion. Always HR-authored — there is no employee-facing "add"
    endpoint for this, unlike identity documents/education records, which
    the candidate submits themselves. Deliberately does NOT override
    `parser_classes` — the project-wide default already includes
    `CamelCaseMultiPartParser` (see config/settings/base.py), which this
    view's serializer-based validation (unlike DocumentListUploadView's raw
    request.data.get() reads) actually depends on to see `letter_type`
    rather than the wire's `letterType`."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if not _can_view_record(request.user, profile):
            return _forbidden()
        letters = EmployeeLetter.objects.filter(employee=profile.employee)
        return Response({'success': True, 'data': EmployeeLetterSerializer(letters, many=True, context={'request': request}).data})

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        serializer = EmployeeLetterWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'file is required'}}, status=400)
        ext = os.path.splitext(file_obj.name)[1].lower()
        if ext not in ALLOWED_DOCUMENT_EXTENSIONS:
            return Response({
                'success': False,
                'error': {'code': 'VALIDATION_ERROR', 'message': f'Unsupported file type "{ext or "unknown"}". Allowed: {", ".join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}.'},
            }, status=400)
        if file_obj.size > MAX_DOCUMENT_SIZE_BYTES:
            return Response({
                'success': False,
                'error': {'code': 'VALIDATION_ERROR', 'message': f'File exceeds the {MAX_DOCUMENT_SIZE_BYTES // (1024 * 1024)} MB limit.'},
            }, status=400)

        letter = EmployeeLetter.objects.create(employee=profile.employee, uploaded_by=request.user, **serializer.validated_data)
        Document.objects.create(
            entity_type='employee_letter', entity_id=str(letter.id), employee=profile.employee,
            file=file_obj, original_filename=file_obj.name, uploaded_by=request.user,
        )
        write_audit(request.user, 'onboarding.employee_letter_added', 'employee_letter', letter.id, {
            'employeeId': profile.employee_id, 'letterType': letter.letter_type,
        })
        return Response({'success': True, 'data': EmployeeLetterSerializer(letter, context={'request': request}).data}, status=201)


class OfferLetterDetailView(APIView):
    """Salary-gated — see `_offer_letter_for` in serializers.py. Not reachable
    by a manager viewing the same onboarding record."""

    permission_classes = [IsAuthenticated]

    def _get_offer(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        employee = getattr(request.user, 'employee', None)
        allowed = is_hr_admin(request.user) or is_finance(request.user) or (employee and employee.id == profile.employee_id)
        if not allowed:
            return None, None
        return profile, profile.current_offer_letter

    def get(self, request, pk):
        profile, offer = self._get_offer(request, pk)
        if profile is None:
            return _forbidden()
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)
        return Response({'success': True, 'data': OfferLetterSerializer(offer, context={'request': request}).data})

    def patch(self, request, pk):
        """Editing an offer still in DRAFT/GENERATED mutates it in place
        (nobody's seen it yet). Editing one already sent/pending/expired
        instead creates a new version and supersedes the old one — see
        docs/REQUIREMENTS.md §11 and services.create_new_offer_version; the
        candidate's old link stops working the instant this returns."""
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        offer = profile.current_offer_letter
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)

        template = None
        if 'template_id' in request.data:
            template = OfferLetterTemplate.objects.filter(pk=request.data['template_id'], is_active=True).first()
            if not template:
                return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid template'}}, status=400)

        editable_fields = (
            'basic_salary', 'hra', 'other_allowances', 'other_components', 'currency',
            'employment_type', 'probation_period_months', 'notice_period_days',
        )
        updates = {field: request.data[field] for field in editable_fields if field in request.data}
        if template is not None:
            updates['template'] = template

        if offer.status in (OFFER_DRAFT, OFFER_GENERATED):
            for field, value in updates.items():
                setattr(offer, field, value)
            offer.save()
            services.generate_offer_letter_document(offer, request.user)
            offer.status = OFFER_GENERATED
            offer.save(update_fields=['status'])
            write_audit(request.user, 'onboarding.offer_letter_updated', 'offer_letter', offer.id, dict(request.data))
            result = offer
        else:
            try:
                result = services.create_new_offer_version(offer, request.user, **updates)
            except OfferWorkflowError as exc:
                return _workflow_error_response(exc)

        return Response({'success': True, 'data': OfferLetterSerializer(result, context={'request': request}).data})


class OfferLetterSendView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        offer = profile.current_offer_letter
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)

        try:
            services.send_offer_letter(offer, actor=request.user)
        except OfferWorkflowError as exc:
            return _workflow_error_response(exc)
        return Response({'success': True, 'data': OfferLetterSerializer(offer, context={'request': request}).data})


class OfferLetterResendView(APIView):
    """`POST /records/{id}/offer-letter/resend` — a fresh signing link for an
    offer that's already out (or expired), same terms. See
    services.resend_offer_letter."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        offer = profile.current_offer_letter
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)

        try:
            services.resend_offer_letter(offer, actor=request.user)
        except OfferWorkflowError as exc:
            return _workflow_error_response(exc)
        return Response({'success': True, 'data': OfferLetterSerializer(offer, context={'request': request}).data})


class OfferLetterCancelView(APIView):
    """`POST /records/{id}/offer-letter/cancel` — withdraws the current
    offer (the "undo" for a Send/Resend done by mistake). See
    services.cancel_offer_letter."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        offer = profile.current_offer_letter
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)

        try:
            services.cancel_offer_letter(offer, actor=request.user)
        except OfferWorkflowError as exc:
            return _workflow_error_response(exc)
        return Response({'success': True, 'data': OfferLetterSerializer(offer, context={'request': request}).data})


class OfferLetterExtendView(APIView):
    """`POST /records/{id}/offer-letter/extend` `{additionalHours}` — pushes
    the signing deadline out without changing anything else. See
    services.extend_offer_letter."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        offer = profile.current_offer_letter
        if offer is None:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No offer letter for this record'}}, status=404)

        try:
            additional_hours = int(request.data.get('additional_hours') or 0)
        except (TypeError, ValueError):
            additional_hours = 0
        if additional_hours <= 0:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'additionalHours must be a positive number.'}},
                status=400,
            )

        try:
            services.extend_offer_letter(offer, actor=request.user, additional_hours=additional_hours)
        except OfferWorkflowError as exc:
            return _workflow_error_response(exc)
        return Response({'success': True, 'data': OfferLetterSerializer(offer, context={'request': request}).data})


def _set_as_default(template):
    """Exactly one active template is `is_default` at a time."""
    OfferLetterTemplate.objects.exclude(pk=template.pk).update(is_default=False)


def _validate_uploaded_docx(file_obj):
    """Fail fast at upload time rather than only discovering a broken file
    the first time someone tries to generate a letter from it."""
    from docxtpl import DocxTemplate

    from .offer_letter_docx import DocxRenderError

    try:
        file_obj.seek(0)
        DocxTemplate(file_obj)
        file_obj.seek(0)
    except Exception as exc:
        raise DocxRenderError(f'That file doesn’t look like a valid .docx: {exc}') from exc


class OfferLetterTemplateListView(APIView):
    # Inherits the project-wide camelCase JSON/multipart parsers (base.py) —
    # a multipart `isDefault` field arrives here already as `is_default`,
    # same as a JSON body would, so the serializer needs no special-casing.
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        templates = OfferLetterTemplate.objects.filter(is_active=True)
        return Response({'success': True, 'data': OfferLetterTemplateSerializer(templates, many=True, context={'request': request}).data})

    def post(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        source_docx = request.FILES.get('file')
        if not request.data.get('body') and not source_docx:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Provide a letter body or upload a Word (.docx) template.'}},
                status=400,
            )
        if source_docx:
            try:
                _validate_uploaded_docx(source_docx)
            except ValueError as exc:
                return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': str(exc)}}, status=400)

        serializer = OfferLetterTemplateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        template = serializer.save(created_by=request.user, source_docx=source_docx)
        if template.is_default or not OfferLetterTemplate.objects.filter(is_active=True, is_default=True).exclude(pk=template.pk).exists():
            template.is_default = True
            template.save(update_fields=['is_default'])
            _set_as_default(template)
        write_audit(request.user, 'onboarding.offer_letter_template_created', 'offer_letter_template', template.id, {'name': template.name})
        return Response({'success': True, 'data': OfferLetterTemplateSerializer(template, context={'request': request}).data}, status=201)


class OfferLetterTemplateDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        template = get_object_or_404(OfferLetterTemplate, pk=pk)

        source_docx = request.FILES.get('file')
        if source_docx:
            try:
                _validate_uploaded_docx(source_docx)
            except ValueError as exc:
                return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': str(exc)}}, status=400)

        serializer = OfferLetterTemplateSerializer(template, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)

        removing_docx = str(request.data.get('remove_source_docx', '')).lower() == 'true'
        final_body = serializer.validated_data.get('body', template.body)
        final_has_docx = bool(source_docx) or (bool(template.source_docx) and not removing_docx)
        if not final_body and not final_has_docx:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'A template needs either a letter body or an uploaded Word file.'}},
                status=400,
            )

        serializer.save()
        if source_docx:
            template.source_docx = source_docx
        elif removing_docx:
            template.source_docx.delete(save=False)
            template.source_docx = None
        template.save()

        if template.is_default:
            _set_as_default(template)
        write_audit(request.user, 'onboarding.offer_letter_template_updated', 'offer_letter_template', template.id, {
            k: v for k, v in request.data.items() if k != 'file'
        })
        return Response({'success': True, 'data': OfferLetterTemplateSerializer(template, context={'request': request}).data})

    def delete(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        template = get_object_or_404(OfferLetterTemplate, pk=pk)
        other_default = OfferLetterTemplate.objects.filter(is_active=True).exclude(pk=template.pk).first()
        if template.is_default and not other_default:
            return Response(
                {'success': False, 'error': {'code': 'CONFLICT', 'message': 'Cannot remove the only template — create another one first.'}},
                status=409,
            )
        template.is_active = False
        template.is_default = False
        template.save(update_fields=['is_active', 'is_default'])
        if other_default and not OfferLetterTemplate.objects.filter(is_active=True, is_default=True).exists():
            other_default.is_default = True
            other_default.save(update_fields=['is_default'])
        write_audit(request.user, 'onboarding.offer_letter_template_deactivated', 'offer_letter_template', template.id, {})
        return Response(status=204)


class OnboardingTaskTemplateListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        templates = OnboardingTaskTemplate.objects.filter(is_active=True)
        return Response({'success': True, 'data': OnboardingTaskTemplateSerializer(templates, many=True).data})

    def post(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        serializer = OnboardingTaskTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        template = serializer.save()
        write_audit(request.user, 'onboarding.template_created', 'onboarding_task_template', template.id, {'title': template.title})
        return Response({'success': True, 'data': OnboardingTaskTemplateSerializer(template).data}, status=201)


class OnboardingTaskTemplateDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        template = get_object_or_404(OnboardingTaskTemplate, pk=pk)
        serializer = OnboardingTaskTemplateSerializer(template, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        write_audit(request.user, 'onboarding.template_updated', 'onboarding_task_template', template.id, dict(request.data))
        return Response({'success': True, 'data': OnboardingTaskTemplateSerializer(template).data})

    def delete(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        template = get_object_or_404(OnboardingTaskTemplate, pk=pk)
        template.is_active = False
        template.save(update_fields=['is_active'])
        write_audit(request.user, 'onboarding.template_deactivated', 'onboarding_task_template', template.id, {})
        return Response(status=204)


class BackgroundVerificationDetailView(APIView):
    """The verification record itself is HR/finance-only, same audience as
    the offer letter — it's collected alongside compensation data and is
    just as sensitive. Status auto-advances to ready_for_review as document
    tasks complete (see services.refresh_background_verification_status);
    only this endpoint's PATCH can set passed/failed — that call is never
    made automatically."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        bgv, _ = BackgroundVerification.objects.get_or_create(profile=profile)
        return Response({'success': True, 'data': BackgroundVerificationSerializer(bgv, context={'request': request}).data})

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        bgv, _ = BackgroundVerification.objects.get_or_create(profile=profile)

        new_status = request.data.get('status')
        if new_status not in (BGV_PASSED, BGV_FAILED):
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'status must be "passed" or "failed"'}},
                status=400,
            )

        bgv.status = new_status
        bgv.notes = request.data.get('notes', bgv.notes)
        bgv.reviewed_by = request.user
        bgv.reviewed_at = timezone.now()
        bgv.save(update_fields=['status', 'notes', 'reviewed_by', 'reviewed_at'])

        write_audit(request.user, 'onboarding.bgv_decided', 'background_verification', bgv.id, {
            'employeeId': profile.employee_id,
            'status': new_status,
        })
        return Response({'success': True, 'data': BackgroundVerificationSerializer(bgv, context={'request': request}).data})


class OnboardingDocumentsDownloadAllView(APIView):
    """`GET /onboarding/records/{id}/documents/download-all` — every
    document the new hire has submitted against their onboarding tasks,
    bundled into one ZIP. The one-click download HR asked for instead of
    opening documents one at a time."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        profile = get_object_or_404(PROFILE_QS, pk=pk)
        zip_bytes = services.build_documents_zip(profile)
        write_audit(request.user, 'onboarding.documents_downloaded', 'onboarding_profile', profile.id, {
            'employeeId': profile.employee_id,
        })
        response = HttpResponse(zip_bytes, content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{profile.employee.employee_code}-documents.zip"'
        return response


def _grant_payload(grant):
    employee = getattr(grant.user, 'employee', None)
    return {
        'id': grant.id,
        'area': grant.area,
        'area_display': grant.get_area_display(),
        'employee_id': employee.id if employee else None,
        'name': employee.full_name if employee else grant.user.email,
        'email': grant.user.email,
        'created_at': grant.created_at,
    }


class AccessGrantListView(APIView):
    """`GET/POST /onboarding/access-grants` — HR Admin gives a named person
    (e.g. payroll) read access to one sensitive area for all new hires."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        grants = OnboardingAccessGrant.objects.select_related('user__employee').order_by('area', 'created_at')
        return Response({'success': True, 'data': {
            'areas': [{'value': v, 'label': l} for v, l in ACCESS_AREA_CHOICES],
            'grants': [_grant_payload(g) for g in grants],
        }})

    def post(self, request):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        area = request.data.get('area')
        if area not in dict(ACCESS_AREA_CHOICES):
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Unknown access area.'}}, status=400)
        employee = get_object_or_404(Employee.objects.select_related('user'), pk=request.data.get('employee_id'))
        grant, created = OnboardingAccessGrant.objects.get_or_create(
            user=employee.user, area=area, defaults={'granted_by': request.user},
        )
        if not created:
            return Response({'success': False, 'error': {'code': 'CONFLICT', 'message': f'{employee.full_name} already has this access.'}}, status=409)
        write_audit(request.user, 'onboarding.access_granted', 'user', employee.user_id, {'area': area, 'employeeId': employee.id})
        return Response({'success': True, 'data': _grant_payload(grant)}, status=201)


class AccessGrantDetailView(APIView):
    """`DELETE /onboarding/access-grants/{id}` — revoke."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        grant = get_object_or_404(OnboardingAccessGrant, pk=pk)
        write_audit(request.user, 'onboarding.access_revoked', 'user', grant.user_id, {'area': grant.area})
        grant.delete()
        return Response(status=204)


class AccessGrantBulkITView(APIView):
    """`POST /onboarding/access-grants/bulk-it` — grant all IT access areas
    (laptop, work_email, id_card) to a person in one request."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import IT_ACCESS_AREAS
        if not is_hr_admin(request.user):
            return _forbidden('HR Admin only')
        employee = get_object_or_404(Employee.objects.select_related('user'), pk=request.data.get('employee_id'))
        granted, skipped = [], []
        for area in IT_ACCESS_AREAS:
            grant, created = OnboardingAccessGrant.objects.get_or_create(
                user=employee.user, area=area, defaults={'granted_by': request.user}
            )
            if created:
                write_audit(request.user, 'onboarding.access_granted', 'user', employee.user_id, {'area': area, 'employeeId': employee.id})
                granted.append(area)
            else:
                skipped.append(area)
        return Response({'success': True, 'data': {'granted': granted, 'alreadyHad': skipped}}, status=201)


class MyOnboardingWorkView(APIView):
    """`GET /onboarding/work` — the workspace for people who aren't HR but
    help onboard: tasks assigned to them by name, plus (masked) data from
    any area HR granted them. Full numbers are revealed through the usual
    per-record endpoints, which audit it."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        tasks = []
        if employee is not None:
            qs = (
                OnboardingTask.objects.filter(assignee=employee)
                .select_related('profile__employee')
                .order_by('status', 'due_date')
            )
            for t in qs:
                tasks.append({
                    **OnboardingTaskSerializer(t).data,
                    'record_id': t.profile_id,
                    'employee_name': t.profile.employee.full_name,
                    'employee_code': t.profile.employee.employee_code,
                    'joining_date': t.profile.employee.joining_date,
                })

        areas = list(OnboardingAccessGrant.objects.filter(user=request.user).values_list('area', flat=True))
        records = []
        if areas:
            profiles = (
                OnboardingProfile.objects.select_related('employee')
                .exclude(employee__status=Employee.STATUS_EXITED)
                .order_by('-employee__joining_date')
            )
            for p in profiles:
                row = {
                    'id': p.id, 'stage': p.stage, 'employee_name': p.employee.full_name,
                    'employee_code': p.employee.employee_code, 'joining_date': p.employee.joining_date,
                }
                if ACCESS_AREA_BANK_DETAILS in areas:
                    bank = BankDetails.objects.filter(employee=p.employee).first()
                    row['bank_details'] = BankDetailsSerializer(bank, context={'mask': True}).data if bank else None
                if ACCESS_AREA_IDENTITY_DOCUMENTS in areas:
                    docs = IdentityDocument.objects.filter(employee=p.employee)
                    row['identity_documents'] = IdentityDocumentSerializer(docs, many=True, context={'request': request, 'mask': True}).data
                if ACCESS_AREA_EDUCATION in areas:
                    edu = EducationRecord.objects.filter(employee=p.employee)
                    row['education_records'] = EducationRecordSerializer(edu, many=True, context={'request': request}).data
                records.append(row)

        return Response({'success': True, 'data': {'tasks': tasks, 'areas': areas, 'records': records}})
