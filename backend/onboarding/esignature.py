"""
E-signature provider abstraction (docs/REQUIREMENTS.md §4).

The candidate always reaches the offer through our own secure, hashed,
expiring token link (models.py::hash_signing_token, views_public.py) — that
part never changes. What a "provider" controls is only *how the candidate's
consent is captured and recorded* once they're on that page. Today there's
no external e-signature vendor configured anywhere in this project, so the
default or is a clean, dependency-free implementation; swapping in
DocuSign/Adobe Sign later means adding one class here and flipping
`ESIGNATURE_PROVIDER` in settings — nothing in services.py, views_public.py,
or the frontend needs to change, because they only ever talk to this
interface.
"""
from dataclasses import dataclass

from django.conf import settings


@dataclass
class SignatureResult:
    signature_name: str
    ip_address: str | None
    user_agent: str


class SignatureProvider:
    """A provider turns "the candidate said yes" into a `SignatureResult` to
    persist on the `OfferLetter`. The state transition itself
    (services.accept_offer) is identical regardless of provider — providers
    never touch offer status directly."""

    #: True for providers where signing completes asynchronously via a
    #: webhook (DOCUMENT_SIGNED event) rather than synchronously inside our
    #: own /offers/sign/<token>/sign call.
    is_async = False

    def capture_signature(self, *, typed_name: str, ip_address: str | None, user_agent: str) -> SignatureResult:
        raise NotImplementedError

    def handle_webhook_event(self, payload: dict, headers: dict) -> 'WebhookEvent | None':
        """Verify + parse a provider webhook payload into a normalized
        `WebhookEvent`, or return None if the payload should be ignored.
        Only meaningful for `is_async` providers — see webhooks.py."""
        raise NotImplementedError


@dataclass
class WebhookEvent:
    external_event_id: str
    event_type: str  # one of WEBHOOK_EVENT_TYPES below
    offer_number: str


WEBHOOK_EVENT_TYPES = {
    'DOCUMENT_SENT', 'DOCUMENT_VIEWED', 'DOCUMENT_SIGNED',
    'DOCUMENT_DECLINED', 'DOCUMENT_EXPIRED', 'DOCUMENT_CANCELLED',
}


class InAppSignatureProvider(SignatureProvider):
    """Default provider. No external dependency, no webhook: the candidate
    types their full legal name, ticks the consent checkbox, and posts
    straight to our own `/offers/sign/<token>/sign` — captured with IP/UA for
    the audit trail. This is a click-wrap signature (E-SIGN/ESIGN-Act style),
    lighter-weight than a vendor's biometric capture, but a real, timestamped,
    non-repudiable record of consent tied to a single-use secure token."""

    def capture_signature(self, *, typed_name, ip_address, user_agent):
        return SignatureResult(signature_name=typed_name, ip_address=ip_address, user_agent=(user_agent or '')[:500])


_PROVIDERS: dict[str, type[SignatureProvider]] = {
    'in_app': InAppSignatureProvider,
    # Register a real vendor adapter here later, e.g.:
    # 'docusign': DocuSignSignatureProvider,
}


def get_signature_provider() -> SignatureProvider:
    name = getattr(settings, 'ESIGNATURE_PROVIDER', 'in_app')
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        raise ValueError(
            f"Unknown ESIGNATURE_PROVIDER '{name}'. Register an adapter class in "
            f"onboarding/esignature.py's _PROVIDERS dict before setting it in settings."
        )
    return provider_cls()
