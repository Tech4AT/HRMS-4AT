"""Resignation / exit: employee self-service + HR review, and the daily
completion step (management command `process_exits`)."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import write_audit
from core.scope import is_hr_admin
from notifications.utils import send_html_email

from .models import Employee, Resignation

DEFAULT_NOTICE_DAYS = 30
EXITABLE_STATUSES = (Employee.STATUS_ACTIVE, Employee.STATUS_ON_LEAVE, Employee.STATUS_PRE_ONBOARDING)


def notice_period_days(employee: Employee) -> int:
    from onboarding.models import OnboardingProfile

    profile = OnboardingProfile.objects.filter(employee=employee).first()
    offer = profile.current_offer_letter if profile else None
    return offer.notice_period_days if offer and offer.notice_period_days else DEFAULT_NOTICE_DAYS


def _employee_email(employee: Employee) -> str:
    return employee.personal_email or employee.work_email


def _hr_recipients() -> list[str]:
    User = get_user_model()
    return list(
        User.objects.filter(is_active=True).filter(Q(is_superuser=True) | Q(role__name='hr_admin'))
        .exclude(email='').values_list('email', flat=True).distinct()
    )


def _fmt(d) -> str:
    return d.strftime('%d %B %Y') if d else '—'


def complete_exit(resignation: Resignation, actor=None) -> None:
    """Employee EXITED and login disabled. Idempotent."""
    if resignation.status != Resignation.STATUS_ACCEPTED:
        return
    with transaction.atomic():
        employee = resignation.employee
        employee.status = Employee.STATUS_EXITED
        employee.save(update_fields=['status'])
        user = employee.user
        user.is_active = False
        user.save(update_fields=['is_active'])
        resignation.status = Resignation.STATUS_COMPLETED
        resignation.completed_at = timezone.now()
        resignation.save(update_fields=['status', 'completed_at', 'updated_at'])
    write_audit(actor, 'employee.exited', 'employee', employee.id, {
        'resignationId': resignation.id, 'lastWorkingDay': str(resignation.last_working_day),
        'trigger': 'manual' if actor else 'scheduled',
    })


def _accept(resignation: Resignation, actor, last_working_day, notes: str) -> None:
    resignation.status = Resignation.STATUS_ACCEPTED
    resignation.last_working_day = last_working_day
    resignation.hr_notes = notes
    resignation.decided_by = actor
    resignation.decided_at = timezone.now()
    resignation.save()
    # They still work their last day; access ends after it (same rule as
    # the daily `process_exits` job).
    if last_working_day < timezone.localdate():
        complete_exit(resignation, actor=actor)


class ResignationSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    decided_by_name = serializers.SerializerMethodField()
    submitted_at = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Resignation
        fields = [
            'id', 'employee', 'reason', 'requested_last_day', 'last_working_day', 'status', 'status_display',
            'initiated_by_hr', 'hr_notes', 'submitted_at', 'decided_by_name', 'decided_at', 'completed_at',
        ]

    def get_employee(self, obj):
        e = obj.employee
        return {
            'id': e.id, 'name': e.full_name, 'employee_code': e.employee_code, 'work_email': e.work_email,
            'department': e.department.name if e.department else None,
            'designation': e.designation.name if e.designation else None,
            'status': e.status,
        }

    def get_decided_by_name(self, obj):
        u = obj.decided_by
        if not u:
            return None
        return f'{u.first_name} {u.last_name}'.strip() or u.email


def _ok(data, status=200):
    return Response({'success': True, 'data': data}, status=status)


def _error(code, message, status):
    return Response({'success': False, 'error': {'code': code, 'message': message}}, status=status)


def _parse_date(value, field):
    if not value:
        raise serializers.ValidationError({field: 'This date is required.'})
    if hasattr(value, 'year'):
        return value
    try:
        return serializers.DateField().to_internal_value(value)
    except serializers.ValidationError:
        raise serializers.ValidationError({field: 'Enter a valid date.'})


class MyResignationView(APIView):
    """`GET/POST /exits/mine`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _ok(None)
        latest = employee.resignations.select_related('decided_by').first()
        notice = notice_period_days(employee)
        return _ok({
            'resignation': ResignationSerializer(latest).data if latest else None,
            'notice_period_days': notice,
            'suggested_last_day': timezone.localdate() + timedelta(days=notice),
            'can_resign': employee.status in EXITABLE_STATUSES
            and not employee.resignations.filter(status__in=Resignation.OPEN_STATUSES).exists(),
        })

    def post(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _error('FORBIDDEN', 'No employee record for this account.', 403)
        if employee.status not in EXITABLE_STATUSES:
            return _error('CONFLICT', 'Your employment status does not allow a resignation.', 409)
        if employee.resignations.filter(status__in=Resignation.OPEN_STATUSES).exists():
            return _error('CONFLICT', 'You already have a resignation in progress.', 409)

        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return _error('VALIDATION_ERROR', 'Please give a reason for resigning.', 400)
        requested = _parse_date(request.data.get('requested_last_day'), 'requested_last_day')
        if requested < timezone.localdate():
            return _error('VALIDATION_ERROR', 'Your last working day cannot be in the past.', 400)

        resignation = Resignation.objects.create(
            employee=employee, reason=reason, requested_last_day=requested, submitted_by=request.user,
        )
        write_audit(request.user, 'employee.resignation_submitted', 'resignation', resignation.id, {
            'employeeId': employee.id, 'requestedLastDay': str(requested),
        })
        for hr_email in _hr_recipients():
            send_html_email(hr_email, f'Resignation submitted — {employee.full_name}', 'employees/emails/hr_resignation_submitted.html', {
                'employee_name': employee.full_name, 'employee_code': employee.employee_code,
                'reason': reason, 'requested_last_day': _fmt(requested),
            })
        send_html_email(_employee_email(employee), 'We received your resignation', 'employees/emails/resignation_received.html', {
            'first_name': employee.first_name, 'requested_last_day': _fmt(requested),
        })
        return _ok(ResignationSerializer(resignation).data, status=201)


class MyResignationWithdrawView(APIView):
    """`POST /exits/mine/withdraw` — only while HR hasn't decided yet."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return _error('FORBIDDEN', 'No employee record for this account.', 403)
        resignation = employee.resignations.filter(status=Resignation.STATUS_SUBMITTED).first()
        if resignation is None:
            return _error('CONFLICT', 'There is no pending resignation to withdraw. If HR has already accepted it, please contact HR.', 409)
        resignation.status = Resignation.STATUS_WITHDRAWN
        resignation.save(update_fields=['status', 'updated_at'])
        write_audit(request.user, 'employee.resignation_withdrawn', 'resignation', resignation.id, {'employeeId': employee.id})
        return _ok(ResignationSerializer(resignation).data)


class ResignationListView(APIView):
    """`GET /exits/resignations?status=` — HR Admin."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hr_admin(request.user):
            return _error('FORBIDDEN', 'HR Admin only', 403)
        qs = Resignation.objects.select_related('employee__department', 'employee__designation', 'decided_by')
        status = request.query_params.get('status')
        if status:
            qs = qs.filter(status__in=status.split(','))
        return _ok(ResignationSerializer(qs, many=True).data)


class ResignationDecisionView(APIView):
    """`POST /exits/resignations/{id}/accept` `{lastWorkingDay, notes}` or
    `.../reject` `{notes}` — HR Admin."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, decision):
        if decision not in ('accept', 'reject'):
            return _error('NOT_FOUND', 'Unknown action.', 404)
        if not is_hr_admin(request.user):
            return _error('FORBIDDEN', 'HR Admin only', 403)
        resignation = get_object_or_404(Resignation.objects.select_related('employee'), pk=pk)
        if resignation.status != Resignation.STATUS_SUBMITTED:
            return _error('CONFLICT', f'This resignation is already {resignation.get_status_display().lower()}.', 409)
        employee = resignation.employee
        notes = str(request.data.get('notes') or '').strip()

        if decision == 'accept':
            last_day = _parse_date(request.data.get('last_working_day') or resignation.requested_last_day, 'last_working_day')
            _accept(resignation, request.user, last_day, notes)
            write_audit(request.user, 'employee.resignation_accepted', 'resignation', resignation.id, {
                'employeeId': employee.id, 'lastWorkingDay': str(last_day),
            })
            send_html_email(_employee_email(employee), 'Your resignation has been accepted', 'employees/emails/resignation_decided.html', {
                'first_name': employee.first_name, 'accepted': True, 'last_working_day': _fmt(last_day), 'notes': notes,
            })
        else:
            if not notes:
                return _error('VALIDATION_ERROR', 'Please give a reason for rejecting the resignation.', 400)
            resignation.status = Resignation.STATUS_REJECTED
            resignation.hr_notes = notes
            resignation.decided_by = request.user
            resignation.decided_at = timezone.now()
            resignation.save()
            write_audit(request.user, 'employee.resignation_rejected', 'resignation', resignation.id, {'employeeId': employee.id})
            send_html_email(_employee_email(employee), 'An update on your resignation', 'employees/emails/resignation_decided.html', {
                'first_name': employee.first_name, 'accepted': False, 'notes': notes,
            })
        resignation.refresh_from_db()
        return _ok(ResignationSerializer(resignation).data)


class InitiateExitView(APIView):
    """`POST /exits/initiate` `{employeeId, lastWorkingDay, reason}` — HR
    exits an employee directly (termination, contract end, absconding...)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_hr_admin(request.user):
            return _error('FORBIDDEN', 'HR Admin only', 403)
        employee = get_object_or_404(Employee, pk=request.data.get('employee_id'))
        if employee.user_id == request.user.id:
            return _error('CONFLICT', 'You cannot exit your own account.', 409)
        if employee.status not in EXITABLE_STATUSES:
            return _error('CONFLICT', f'{employee.full_name} is not a current employee.', 409)
        if employee.resignations.filter(status__in=Resignation.OPEN_STATUSES).exists():
            return _error('CONFLICT', f'{employee.full_name} already has an exit in progress — review it in the list below.', 409)
        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return _error('VALIDATION_ERROR', 'Please give a reason for the exit.', 400)
        last_day = _parse_date(request.data.get('last_working_day'), 'last_working_day')

        resignation = Resignation.objects.create(
            employee=employee, reason=reason, requested_last_day=last_day,
            initiated_by_hr=True, submitted_by=request.user,
        )
        _accept(resignation, request.user, last_day, '')
        write_audit(request.user, 'employee.exit_initiated', 'resignation', resignation.id, {
            'employeeId': employee.id, 'lastWorkingDay': str(last_day),
        })
        send_html_email(_employee_email(employee), 'Information about your exit', 'employees/emails/resignation_decided.html', {
            'first_name': employee.first_name, 'accepted': True, 'hr_initiated': True, 'last_working_day': _fmt(last_day), 'notes': reason,
        })
        resignation.refresh_from_db()
        return _ok(ResignationSerializer(resignation).data, status=201)
