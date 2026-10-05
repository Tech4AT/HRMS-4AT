"""A direct function call at the point of action — no message broker, no
pub/sub (docs/ARCHITECTURE.md primitive #5). The dev settings point
EMAIL_BACKEND at the console so nothing needs real SMTP to run locally."""
import logging

from django.conf import settings
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags

logger = logging.getLogger('notifications.email')


def _deliver(message, to: str, subject: str) -> bool:
    """Never raises (an email failure mustn't undo e.g. an offer signing),
    but never hides a failure either — every send is logged either way."""
    try:
        message.send(fail_silently=False)
    except Exception:
        logger.exception('Email FAILED to=%s subject=%r', to, subject)
        return False
    logger.info('Email sent to=%s subject=%r', to, subject)
    return True


def send_email(to: str, subject: str, body: str) -> None:
    if not to:
        return
    _deliver(EmailMessage(subject=subject, body=body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to]), to, subject)


def send_email_with_attachment(to: str, subject: str, body: str, filename: str, content: bytes, mimetype: str) -> None:
    if not to:
        return
    message = EmailMessage(subject=subject, body=body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to])
    message.attach(filename, content, mimetype)
    _deliver(message, to, subject)


def send_html_email(to: str, subject: str, template_name: str, context: dict,
                     attachment: tuple[str, bytes, str] | None = None) -> None:
    """Renders `template_name` (a Django template under some app's
    `templates/`, e.g. `onboarding/emails/welcome.html`) to HTML, sends it
    with a plain-text fallback (auto-derived — email clients that can't
    render HTML still get something legible), and optionally an attachment
    as `(filename, content_bytes, mimetype)`."""
    if not to:
        return
    context = {'company_name': settings.COMPANY_NAME, 'company_initial': settings.COMPANY_NAME[:1].upper(), **context}
    html_body = render_to_string(template_name, context)
    text_body = strip_tags(html_body)

    message = EmailMultiAlternatives(
        subject=subject, body=text_body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to],
    )
    message.attach_alternative(html_body, 'text/html')
    if attachment:
        message.attach(*attachment)
    _deliver(message, to, subject)
