import type { IdentityDocumentType } from '@/lib/api/onboarding';

/** Mirrors backend/employees/identity_numbers.py — keep the two in step. */

export type IdentityField = 'fullName' | 'dateOfBirth' | 'gender' | 'parentOrGuardianName' | 'address' | 'expiryDate';

interface IdentityTypeSpec {
  pattern: RegExp;
  rule: string;
  placeholder: string;
  /** Max length of the normalized value (spaces/hyphens stripped). */
  maxLength: number;
  numeric: boolean;
  /** Fields printed on this document — the only ones the form asks for. */
  fields: IdentityField[];
  parentLabel?: string;
}

export const IDENTITY_TYPE_SPEC: Record<IdentityDocumentType, IdentityTypeSpec> = {
  aadhaar: {
    pattern: /^[2-9][0-9]{11}$/,
    rule: 'Aadhaar number must be 12 digits and cannot start with 0 or 1.',
    placeholder: '1234 5678 9012',
    maxLength: 12,
    numeric: true,
    fields: ['fullName', 'dateOfBirth', 'gender', 'address'],
  },
  pan: {
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    rule: 'PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).',
    placeholder: 'ABCDE1234F',
    maxLength: 10,
    numeric: false,
    fields: ['fullName', 'parentOrGuardianName', 'dateOfBirth'],
    parentLabel: "Father's name",
  },
  voter_id: {
    pattern: /^[A-Z]{3}[0-9]{7}$/,
    rule: 'Voter ID (EPIC) must be 3 letters followed by 7 digits (e.g. ABC1234567).',
    placeholder: 'ABC1234567',
    maxLength: 10,
    numeric: false,
    fields: ['fullName', 'parentOrGuardianName', 'gender', 'dateOfBirth', 'address'],
    parentLabel: "Father's / husband's name",
  },
  passport: {
    pattern: /^[A-Z][0-9]{7}$/,
    rule: 'Passport number must be 1 letter followed by 7 digits (e.g. A1234567).',
    placeholder: 'A1234567',
    maxLength: 8,
    numeric: false,
    fields: ['fullName', 'dateOfBirth', 'gender', 'expiryDate', 'address'],
  },
  driving_license: {
    pattern: /^[A-Z]{2}[0-9]{13}$/,
    rule: 'Driving licence must be 15 characters: 2-letter state code, then 13 digits (e.g. MH1220110012345).',
    placeholder: 'MH12 20110012345',
    maxLength: 15,
    numeric: false,
    fields: ['fullName', 'dateOfBirth', 'parentOrGuardianName', 'expiryDate', 'address'],
    parentLabel: "Son / daughter / wife of",
  },
  other: {
    pattern: /^[A-Z0-9/]{3,64}$/,
    rule: 'Document number must be 3–64 letters or digits.',
    placeholder: 'Document number',
    maxLength: 64,
    numeric: false,
    fields: ['fullName', 'dateOfBirth', 'expiryDate'],
  },
};

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits: string): boolean {
  let c = 0;
  digits.split('').reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

export function normalizeIdentityNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Returns an error message, or null if valid. */
export function validateIdentityNumber(type: IdentityDocumentType, value: string): string | null {
  const spec = IDENTITY_TYPE_SPEC[type];
  const n = normalizeIdentityNumber(value);
  if (!n) return 'Document number is required.';
  if (!spec.pattern.test(n)) return spec.rule;
  if (type === 'aadhaar' && !verhoeffValid(n)) return 'This is not a valid Aadhaar number — please check for a typo.';
  return null;
}

/** Display grouping: "2341 2341 2346" for Aadhaar, raw otherwise. */
export function formatIdentityNumber(type: IdentityDocumentType, value: string): string {
  if (type === 'aadhaar') return value.replace(/(\d{4})(?=\d)/g, '$1 ');
  return value;
}
