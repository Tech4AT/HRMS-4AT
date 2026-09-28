"""Format rules for Indian identity document numbers. Mirrored on the
frontend in lib/identityDocuments.ts — keep the two in step."""
import re

# Verhoeff tables — UIDAI's check digit algorithm for Aadhaar.
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


# document_type -> (regex on the normalized value, human-readable rule)
RULES = {
    'aadhaar': (r'^[2-9][0-9]{11}$', 'Aadhaar number must be 12 digits and cannot start with 0 or 1.'),
    'pan': (r'^[A-Z]{5}[0-9]{4}[A-Z]$', 'PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).'),
    'voter_id': (r'^[A-Z]{3}[0-9]{7}$', 'Voter ID (EPIC) must be 3 letters followed by 7 digits (e.g. ABC1234567).'),
    'passport': (r'^[A-Z][0-9]{7}$', 'Passport number must be 1 letter followed by 7 digits (e.g. A1234567).'),
    'driving_license': (
        r'^[A-Z]{2}[0-9]{13}$',
        'Driving licence must be 15 characters: 2-letter state code, then 13 digits (e.g. MH1220110012345).',
    ),
    'other': (r'^[A-Z0-9/]{3,64}$', 'Document number must be 3–64 letters or digits.'),
}


def normalize(value: str) -> str:
    """Numbers are commonly written with spaces/hyphens ("1234 5678 9012",
    "MH12-20110012345") — stored without them, uppercased."""
    return re.sub(r'[\s-]', '', value or '').upper()


def validate(document_type: str, value: str) -> tuple[str, str | None]:
    """Returns (normalized_value, error_message_or_None)."""
    number = normalize(value)
    pattern, message = RULES.get(document_type, RULES['other'])
    if not re.fullmatch(pattern, number):
        return number, message
    if document_type == 'aadhaar' and not verhoeff_valid(number):
        return number, 'This is not a valid Aadhaar number — please check for a typo.'
    return number, None
