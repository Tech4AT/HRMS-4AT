/**
 * Candidate-facing offer signing API client. Unauthenticated by design — the
 * secure token in the URL (see app/offer/[token]/page.tsx) is the only
 * credential; this never touches the HRMS session cookies (see
 * app/api/offers/[...path]/route.ts). Talks only to the local
 * `/api/offers/*` route handler, never the Django backend directly.
 */
import type { OfferLetterStatus, OfferRejectionReason } from './onboarding';

export interface CandidateOffer {
  offerNumber: string;
  version: number;
  status: OfferLetterStatus;
  statusDisplay: string;
  companyName: string;
  candidateName: string;
  designation: string | null;
  department: string | null;
  joiningDate: string;
  employmentTypeDisplay: string;
  basicSalary: string;
  hra: string;
  otherAllowances: string;
  otherComponents: string;
  annualCtc: string;
  currency: string;
  probationPeriodMonths: number;
  noticePeriodDays: number;
  expiresAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: OfferRejectionReason | '';
  documentUrl: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class OfferApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OfferApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/offers${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  });

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;
    throw new OfferApiError(message, res.status, json?.error?.code);
  }

  return json.data as T;
}

export const offerApi = {
  get: (token: string) => request<CandidateOffer>(`/sign/${token}`),
  sign: (token: string, signatureName: string, agree: boolean) =>
    request<CandidateOffer>(`/sign/${token}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signatureName, agree }),
    }),
  reject: (token: string, reason: OfferRejectionReason, comments: string) =>
    request<CandidateOffer>(`/sign/${token}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, comments }),
    }),
  documentUrl: (token: string) => `/api/offers/sign/${token}/document`,
};
