from django.core.management.base import BaseCommand

from onboarding.models import OfferLetterTemplate

DEFAULT_BODY = """Dear {{first_name}} {{last_name}},

We are pleased to offer you the position of **{{designation}}**, with a proposed joining date of **{{joining_date}}**.

**Compensation:** Your annual Cost to Company (CTC) will be **{{package}}**, payable per the company's standard payroll cycle and structure.

**Employment type:** {{employment_type}}.

**Probation period:** {{probation_period_months}} months from your date of joining, during which either party may terminate this offer with immediate effect.

**Notice period:** Following confirmation, this role requires {{notice_period_days}} days' written notice from either party to terminate employment.

This offer is subject to satisfactory completion of background verification and submission of the documents requested during onboarding. Please review the attached terms and return a signed copy to confirm your acceptance.

We look forward to welcoming you to the team.

Sincerely,
Human Resources"""

INTERN_BODY = """Dear {{first_name}} {{last_name}},

We are excited to offer you an internship as **{{designation}}**, starting **{{joining_date}}**.

**Stipend:** You will receive a stipend of **{{package}}** per annum (pro-rated), paid per the company's standard payroll cycle.

**Duration & type:** {{employment_type}}. This internship does not carry a probation period.

**Notice period:** Either party may end this internship with {{notice_period_days}} days' written notice.

Your internship is subject to satisfactory submission of the documents requested during onboarding. Please review the attached terms and return a signed copy to confirm your acceptance.

We're looking forward to having you with us!

Sincerely,
Human Resources"""


class Command(BaseCommand):
    help = 'Idempotently seed a default offer-letter template (and an intern variant).'

    def handle(self, *args, **options):
        default, created = OfferLetterTemplate.objects.get_or_create(
            name='Standard Offer Letter',
            defaults={'heading': 'Offer of Employment', 'body': DEFAULT_BODY, 'is_default': True},
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created default template "Standard Offer Letter"'))
        elif not OfferLetterTemplate.objects.filter(is_active=True, is_default=True).exists():
            default.is_default = True
            default.is_active = True
            default.save(update_fields=['is_default', 'is_active'])
            self.stdout.write(self.style.SUCCESS('Marked "Standard Offer Letter" as default'))
        else:
            self.stdout.write('"Standard Offer Letter" already exists')

        _, created = OfferLetterTemplate.objects.get_or_create(
            name='Intern Offer Letter',
            defaults={'heading': 'Internship Offer', 'body': INTERN_BODY, 'is_default': False},
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created template "Intern Offer Letter"'))
        else:
            self.stdout.write('"Intern Offer Letter" already exists')
