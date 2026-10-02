"""Offer-letter salary, computed by the payroll engine.

HR only enters the annual package (CTC). The breakup — Basic, HRA, allowances,
employer contributions … — comes from an active payroll SalaryStructure via
`payroll.engine.breakup`, never from hand-typed components. Two optional extras
can be layered on top of the package: a bonus and an extra allowance.

The four legacy OfferLetter columns (basic_salary / hra / other_allowances /
other_components) are still filled from the breakup so offer-letter templates,
PDFs and the candidate signing page keep working unchanged:

    basic_salary      = BASIC (annual)
    hra               = HRA (annual)
    other_allowances  = package - basic - hra (every other CTC component)
    other_components  = bonus + extra allowance
"""

import datetime
from decimal import Decimal, InvalidOperation

from payroll import models as payroll_models
from payroll.services import config as config_service


def _money(value) -> Decimal:
    try:
        amount = Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        raise ValueError('Enter a valid amount.')
    if amount < 0:
        raise ValueError('Amounts cannot be negative.')
    return amount.quantize(Decimal('0.01'))


def active_structures(as_of=None):
    as_of = as_of or datetime.date.today()
    return payroll_models.SalaryStructure.objects.filter(
        status='active', effective_from__lte=as_of,
    ).order_by('name')


def pick_structure(structure_id=None, as_of=None):
    qs = active_structures(as_of)
    if structure_id:
        structure = qs.filter(pk=structure_id).first()
        if structure is None:
            raise ValueError('That salary structure is not active.')
        return structure
    structure = qs.first()
    if structure is None:
        raise ValueError('No active salary structure — set one up in Payroll → Salary structures first.')
    return structure


def compute_offer_salary(annual_package, *, structure_id=None, bonus=0, extra_allowance=0, as_of=None) -> dict:
    """Return the full salary picture for an offer, or raise ValueError."""
    as_of = as_of or datetime.date.today()
    package = _money(annual_package)
    if package <= 0:
        raise ValueError('Enter the annual package (CTC).')
    bonus = _money(bonus)
    extra = _money(extra_allowance)

    structure = pick_structure(structure_id, as_of)
    if (structure.min_ctc and package < structure.min_ctc) or (structure.max_ctc and package > structure.max_ctc):
        raise ValueError(
            f'{structure.name} is for packages between {structure.min_ctc or 0} and {structure.max_ctc or "any"}.'
        )

    lines, _version = config_service.lines_for(structure, as_of)
    breakup = config_service.preview_structure(
        lines,
        package,
        as_of=as_of,
        tolerance=structure.ctc_tolerance,
        # A new hire has no payroll profile yet — assume the common statutory set.
        applicability={'pf': True, 'esi': False, 'pt': True, 'lwf': False},
    )
    if not breakup.get('valid'):
        raise ValueError('; '.join(breakup.get('errors') or ['The salary structure could not be calculated.']))

    by_code = {line['code']: line for line in breakup['lines']}
    basic = Decimal(str(by_code.get('BASIC', {}).get('annual', 0)))
    hra = Decimal(str(by_code.get('HRA', {}).get('annual', 0)))
    other_allowances = max(package - basic - hra, Decimal('0'))

    return {
        'structure': {'id': str(structure.pk), 'code': structure.code, 'name': structure.name},
        'annual_package': package,
        'bonus': bonus,
        'extra_allowance': extra,
        'total_compensation': package + bonus + extra,
        'breakup': breakup,
        'components': {
            'basic_salary': basic,
            'hra': hra,
            'other_allowances': other_allowances,
            'other_components': bonus + extra,
        },
    }


def stored_breakup(result: dict) -> dict:
    """What gets saved on the OfferLetter (JSON-safe)."""
    return {
        'structure': result['structure'],
        'annualPackage': str(result['annual_package']),
        'bonus': str(result['bonus']),
        'extraAllowance': str(result['extra_allowance']),
        'totalCompensation': str(result['total_compensation']),
        'breakup': result['breakup'],
    }
