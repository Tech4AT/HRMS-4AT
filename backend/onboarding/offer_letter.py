"""Renders an `OfferLetter` to a PDF using its `OfferLetterTemplate`. The
template's `body` is plain text HR edits themselves (see models.py's
`OfferLetterTemplate` docstring and `OFFER_LETTER_PLACEHOLDERS`) — this module
only does placeholder substitution and paragraph layout, never executes
anything from the template (no template language, no `eval`)."""
import io
import re
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

_BOLD_RE = re.compile(r'\*\*(.+?)\*\*')


def _format_amount(amount, currency: str) -> str:
    return f'{currency} {amount:,.2f}'


def build_placeholder_context(offer) -> dict:
    """The values available to a template's `{{placeholder}}` tokens — kept
    in one place so the HR-facing template editor's helper text and the
    actual renderer never drift apart (see models.OFFER_LETTER_PLACEHOLDERS)."""
    employee = offer.profile.employee
    return {
        'first_name': employee.first_name,
        'last_name': employee.last_name,
        'full_name': employee.full_name,
        'designation': employee.designation.name if employee.designation else 'the offered role',
        'department': employee.department.name if employee.department else '',
        'reporting_manager': employee.manager.full_name if employee.manager else 'your HR contact',
        'employee_code': employee.employee_code,
        'joining_date': employee.joining_date.strftime('%d %B %Y'),
        'package': _format_amount(offer.annual_ctc, offer.currency),
        'monthly_package': _format_amount(offer.annual_ctc / 12, offer.currency),
        'basic_salary': _format_amount(offer.basic_salary, offer.currency),
        'basic_salary_monthly': _format_amount(offer.basic_salary / 12, offer.currency),
        'hra': _format_amount(offer.hra, offer.currency),
        'hra_monthly': _format_amount(offer.hra / 12, offer.currency),
        'other_allowances': _format_amount(offer.other_allowances, offer.currency),
        'other_allowances_monthly': _format_amount(offer.other_allowances / 12, offer.currency),
        'other_components': _format_amount(offer.other_components, offer.currency),
        'other_components_monthly': _format_amount(offer.other_components / 12, offer.currency),
        'employment_type': offer.get_employment_type_display(),
        'probation_period_months': str(offer.probation_period_months),
        'notice_period_days': str(offer.notice_period_days),
        'today': date.today().strftime('%d %B %Y'),
        # Blank until signed — a template can reference {{signature_name}}/
        # {{signed_date}} and get nothing pre-signature, the real values
        # once `generate_offer_letter_document` re-renders post-signature
        # (see services.py::accept_offer). The plain-text renderer below
        # doesn't wait on the template author using these — it always
        # appends a signature block itself once `offer.signed_at` is set.
        'signature_name': offer.signature_name or '',
        'signed_date': offer.signed_at.strftime('%d %B %Y, %I:%M %p') if offer.signed_at else '',
    }


def _substitute(text: str, context: dict) -> str:
    for key, value in context.items():
        text = text.replace('{{' + key + '}}', str(value))
    return text


def _paragraph_markup(text: str) -> str:
    """Escape as plain text, then re-enable `**bold**` as reportlab's
    mini-XML `<b>` — escaping first means user-typed `<`/`&`/`>` can never be
    interpreted as markup."""
    escaped = escape(text)
    return _BOLD_RE.sub(r'<b>\1</b>', escaped)


def render_offer_letter_pdf(offer) -> bytes:
    """Dispatches to the uploaded-.docx renderer when the template has one
    (see offer_letter_docx.py), otherwise renders the plain-text `body`
    through reportlab below."""
    template = offer.template
    if template and template.source_docx:
        from .offer_letter_docx import render_docx_template_to_pdf

        context = build_placeholder_context(offer)
        return render_docx_template_to_pdf(template.source_docx.path, context, signed=bool(offer.signed_at))
    return _render_text_template_pdf(offer)


def _render_text_template_pdf(offer) -> bytes:
    template = offer.template
    context = build_placeholder_context(offer)

    heading_text = _substitute(template.heading, context) if template else 'Offer of Employment'
    body_text = _substitute(template.body, context) if template else ''
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body_text) if p.strip()]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=2.5 * cm, bottomMargin=2.5 * cm, leftMargin=2.5 * cm, rightMargin=2.5 * cm,
    )
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10.5, leading=16, spaceAfter=10)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=16, spaceAfter=18)
    small_style = ParagraphStyle('Small', parent=styles['Normal'], fontSize=9, textColor='#666666')

    story = [
        Paragraph(_paragraph_markup(heading_text), heading_style),
        Paragraph(f'Date: {context["today"]}', small_style),
        Spacer(1, 0.6 * cm),
    ]
    for para in paragraphs:
        # A line inside a paragraph is a soft break (e.g. "Sincerely,\nHuman Resources").
        line_html = _paragraph_markup(para).replace('\n', '<br/>')
        story.append(Paragraph(line_html, body_style))

    if offer.signed_at:
        # Baked into the document itself once signed — not just DB columns
        # the UI happens to display. Regenerated by
        # services.py::accept_offer immediately after signing, so this
        # never appears on the pre-signature PDF a candidate reviews.
        signature_style = ParagraphStyle('Signature', parent=styles['Heading2'], fontSize=12, spaceBefore=6, spaceAfter=6)
        story += [
            Spacer(1, 1 * cm),
            Paragraph('Signed and Accepted', signature_style),
            Paragraph(_paragraph_markup(f'Signature: {offer.signature_name}'), body_style),
            Paragraph(_paragraph_markup(f'Date: {context["signed_date"]}'), small_style),
        ]

    story += [
        Spacer(1, 1 * cm),
        Paragraph('This is a system-generated offer letter.', small_style),
    ]
    doc.build(story)
    return buf.getvalue()
