"""
Candidate-facing offer endpoints (docs/REQUIREMENTS.md §6-§9). Unauthenticated
by design — the candidate has no HRMS login yet, so the secure, hashed,
expiring signing token *is* the credential (see models.py::hash_signing_token
and services.resolve_offer_by_token). Nothing here trusts a database id from
the URL; everything resolves through the token, so one candidate can never
reach another candidate's offer by guessing/incrementing an id (IDOR — see
docs/REQUIREMENTS.md §21).
"""
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.utils import write_audit
from django.conf import settings
from django.http import FileResponse

from . import services
from .exceptions import OfferWorkflowError
from .models import OFFER_REJECTION_REASON_CHOICES


def _client_ip(request) -> str | None:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _user_agent(request) -> str:
    return request.META.get('HTTP_USER_AGENT', '')[:500]


class CandidateOfferSerializer(serializers.Serializer):
    """The candidate's own read-only view of their (current) offer — see the
    mockup in docs/REQUIREMENTS.md §6. Intentionally a distinct shape from
    the HR-facing OfferLetterSerializer: no internal profile/employee ids,
    no template/created_by, nothing HR-only."""

    offer_number = serializers.CharField()
    version = serializers.IntegerField()
    status = serializers.CharField()
    status_display = serializers.CharField(source='get_status_display')
    company_name = serializers.SerializerMethodField()
    candidate_name = serializers.SerializerMethodField()
    designation = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    joining_date = serializers.DateField(source='profile.employee.joining_date')
    employment_type_display = serializers.CharField(source='get_employment_type_display')
    basic_salary = serializers.DecimalField(max_digits=12, decimal_places=2)
    hra = serializers.DecimalField(max_digits=12, decimal_places=2)
    other_allowances = serializers.DecimalField(max_digits=12, decimal_places=2)
    other_components = serializers.DecimalField(max_digits=12, decimal_places=2)
    annual_ctc = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    probation_period_months = serializers.IntegerField()
    notice_period_days = serializers.IntegerField()
    expires_at = serializers.DateTimeField()
    sent_at = serializers.DateTimeField()
    viewed_at = serializers.DateTimeField()
    signed_at = serializers.DateTimeField()
    accepted_at = serializers.DateTimeField()
    rejected_at = serializers.DateTimeField()
    rejection_reason = serializers.CharField()
    document_url = serializers.SerializerMethodField()

    def get_company_name(self, obj):
        return settings.COMPANY_NAME

    def get_candidate_name(self, obj):
        return obj.profile.employee.full_name

    def get_designation(self, obj):
        return obj.profile.employee.designation.name if obj.profile.employee.designation else None

    def get_department(self, obj):
        return obj.profile.employee.department.name if obj.profile.employee.department else None

    def get_document_url(self, obj):
        if not obj.document:
            return None
        request = self.context.get('request')
        try:
            url = obj.document.file.url
        except ValueError:
            return None
        return request.build_absolute_uri(url) if request else url


class CandidateOfferView(APIView):
    """`GET /api/v1/offers/sign/<token>` — resolves the token, lazily expires
    it if due, and records the first open (viewed_at) before returning the
    candidate's read-only view. Never raises for an already-decided offer
    (accepted/rejected) — the page still needs to render the final state."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'offer_public_read'

    def get(self, request, token):
        try:
            offer = services.resolve_offer_by_token(token)
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)

        offer = services.mark_offer_expired_if_due(offer)
        offer = services.mark_offer_viewed(offer)
        data = CandidateOfferSerializer(offer, context={'request': request}).data
        return Response({'success': True, 'data': data})


class CandidateOfferSignView(APIView):
    """`POST /api/v1/offers/sign/<token>/sign` `{signatureName, agree}` —
    the Accept & Sign action (docs/REQUIREMENTS.md §7). Delegates the actual
    transition to services.accept_offer, which is row-locked and idempotent."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'offer_public_write'

    def post(self, request, token):
        try:
            offer = services.resolve_offer_by_token(token)
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)

        # Parsed by the project-wide CamelCaseJSONParser (config/settings/base.py)
        # — an incoming `signatureName` arrives here already as `signature_name`.
        signature_name = str(request.data.get('signature_name') or '')
        agree = bool(request.data.get('agree'))

        try:
            offer = services.accept_offer(
                offer.id,
                typed_name=signature_name,
                agreed=agree,
                ip_address=_client_ip(request),
                user_agent=_user_agent(request),
                actor=None,
            )
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)

        data = CandidateOfferSerializer(offer, context={'request': request}).data
        return Response({'success': True, 'data': data})


class CandidateOfferRejectView(APIView):
    """`POST /api/v1/offers/sign/<token>/reject` `{reason, comments}` — the
    Reject Offer action (docs/REQUIREMENTS.md §8). Delegates to
    services.reject_offer."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'offer_public_write'

    def post(self, request, token):
        try:
            offer = services.resolve_offer_by_token(token)
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)

        reason = str(request.data.get('reason') or '')
        comments = str(request.data.get('comments') or '')
        if reason not in dict(OFFER_REJECTION_REASON_CHOICES):
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'Choose a valid rejection reason.'}},
                status=400,
            )

        try:
            offer = services.reject_offer(
                offer.id,
                reason=reason,
                comments=comments,
                ip_address=_client_ip(request),
                user_agent=_user_agent(request),
                actor=None,
            )
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)

        data = CandidateOfferSerializer(offer, context={'request': request}).data
        return Response({'success': True, 'data': data})


class CandidateOfferDocumentView(APIView):
    """`GET /api/v1/offers/sign/<token>/document` — streams the offer PDF
    without exposing the underlying `documents.Document` id or requiring the
    candidate to already know the media URL (same token gate as the rest of
    this module)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'offer_public_read'

    def get(self, request, token):
        try:
            offer = services.resolve_offer_by_token(token)
        except OfferWorkflowError as exc:
            return Response({'success': False, 'error': {'code': exc.code, 'message': exc.message}}, status=exc.status_code)
        offer = services.mark_offer_expired_if_due(offer)
        if not offer.document:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No document for this offer'}}, status=404)

        write_audit(None, 'onboarding.offer_document_downloaded', 'offer_letter', offer.id, {
            'employeeId': offer.profile.employee_id,
        })
        return FileResponse(
            offer.document.file.open('rb'), as_attachment=False,
            filename=offer.document.original_filename, content_type='application/pdf',
        )
