"""
`POST /api/v1/webhooks/esign` — the receiving end for an *async* e-signature
provider (docs/REQUIREMENTS.md §16-17). Only meaningful once
`settings.ESIGNATURE_PROVIDER` points at a provider with `is_async=True`
(see esignature.py) — the default `InAppSignatureProvider` never calls this;
the candidate completes signing synchronously through our own
`/offers/sign/<token>/sign`. This view exists so wiring up a real vendor
later is "add an adapter class", not "add a webhook endpoint too".
"""
import hashlib
import hmac

from django.conf import settings
from django.db import IntegrityError, transaction
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .esignature import SignatureResult, get_signature_provider
from .exceptions import OfferWorkflowError
from .models import OfferLetter, OnboardingWebhookEvent
from .services import accept_offer, reject_offer


def _verify_signature(request) -> bool:
    """HMAC-SHA256 over the raw request body, hex digest in `X-Signature` —
    a generic scheme most providers' adapters can map their own
    (differently-named) signature header onto. Rejects the request outright
    if no secret is configured, rather than silently accepting unsigned
    webhooks."""
    secret = settings.ESIGN_WEBHOOK_SECRET
    if not secret:
        return False
    provided = request.headers.get('X-Signature', '')
    expected = hmac.new(secret.encode('utf-8'), request.body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


class ESignWebhookView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]

    def post(self, request):
        if not _verify_signature(request):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Invalid webhook signature.'}}, status=403)

        provider = get_signature_provider()
        if not provider.is_async:
            return Response(
                {'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'No async e-signature provider is configured.'}},
                status=404,
            )

        event = provider.handle_webhook_event(request.data, dict(request.headers))
        if event is None:
            return Response({'success': True, 'data': {'ignored': True}})

        # Idempotency (docs/REQUIREMENTS.md §17): the unique constraint is
        # the actual guarantee — a duplicate (provider, external_event_id)
        # loses the race here and this request becomes a no-op, even under
        # concurrent delivery of the same event.
        try:
            with transaction.atomic():
                offer = OfferLetter.objects.filter(offer_number=event.offer_number, is_current=True).first()
                OnboardingWebhookEvent.objects.create(
                    provider=settings.ESIGNATURE_PROVIDER,
                    external_event_id=event.external_event_id,
                    event_type=event.event_type,
                    offer=offer,
                    payload_json=request.data if isinstance(request.data, dict) else {},
                )
        except IntegrityError:
            return Response({'success': True, 'data': {'duplicate': True}})

        if offer is None:
            return Response({'success': True, 'data': {'offerNotFound': True}})

        try:
            if event.event_type == 'DOCUMENT_SIGNED':
                # The vendor captured the actual signature on *their*
                # platform — we don't call our own provider's
                # capture_signature() again (InAppSignatureProvider isn't
                # even what's configured here); build the record straight
                # from what the webhook told us.
                signature = SignatureResult(
                    signature_name=offer.profile.employee.full_name,
                    ip_address=None,
                    user_agent=f'webhook:{settings.ESIGNATURE_PROVIDER}',
                )
                accept_offer(offer.id, actor=None, signature=signature)
            elif event.event_type == 'DOCUMENT_DECLINED':
                reject_offer(offer.id, reason='other', comments='Declined via e-signature provider.', actor=None)
            # DOCUMENT_SENT/VIEWED/EXPIRED/CANCELLED are informational for an
            # async provider whose own portal already tracks them — nothing
            # else in our state machine needs to react.
        except OfferWorkflowError:
            # Already in a terminal/mismatched state — the event arrived
            # late or duplicate-but-not-byte-identical; nothing to do.
            pass

        return Response({'success': True, 'data': {'processed': True}})
