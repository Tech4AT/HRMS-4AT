/**
 * Browser-side Approvals API client. Talks only to the local
 * `/api/requests/*` route handler (never the backend directly);
 * it proxies to the backend and carries the httpOnly session cookie.
 *
 * The backend returns snake_case fields (the approvals endpoints skip the
 * project's camelCase conversion); this client maps them to camelCase.
 */

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface ApprovalRequest {
  id: string;
  requestType: string;
  requester: string;
  approver: string | null;
  status: RequestStatus;
  payload: Record<string, unknown>;
  decisionNote: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Raw backend shape (snake_case). */
interface RawRequest {
  id: string;
  request_type: string;
  requester: string;
  approver: string | null;
  status: RequestStatus;
  payload: Record<string, unknown>;
  decision_note: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

function toApprovalRequest(r: RawRequest): ApprovalRequest {
  return {
    id: r.id,
    requestType: r.request_type,
    requester: r.requester,
    approver: r.approver,
    status: r.status,
    payload: r.payload ?? {},
    decisionNote: r.decision_note ?? '',
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class RequestsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RequestsApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/requests${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
      : init?.headers,
  });

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : raw || `Request failed (${res.status})`;

    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new RequestsApiError(message, res.status);
  }

  return json.data as T;
}

export const requestsApi = {
  list: async (): Promise<ApprovalRequest[]> => {
    const raw = await request<RawRequest[]>('');
    return (raw ?? []).map(toApprovalRequest);
  },
  // Raise a request. The backend auto-routes the approver to the requester's
  // manager; `payload` carries the flow-specific fields (reason, dates, …).
  create: async (
    requestType: string,
    payload: Record<string, unknown>,
  ): Promise<ApprovalRequest> => {
    const raw = await request<RawRequest>('', {
      method: 'POST',
      body: JSON.stringify({ requestType, payload }),
    });
    return toApprovalRequest(raw);
  },
  approve: async (id: string, note?: string): Promise<ApprovalRequest> => {
    const raw = await request<RawRequest>(`/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? '' }),
    });
    return toApprovalRequest(raw);
  },
  reject: async (id: string, note?: string): Promise<ApprovalRequest> => {
    const raw = await request<RawRequest>(`/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? '' }),
    });
    return toApprovalRequest(raw);
  },
  withdraw: async (id: string): Promise<ApprovalRequest> => {
    const raw = await request<RawRequest>(`/${id}/withdraw`, {
      method: 'POST',
    });
    return toApprovalRequest(raw);
  },
};
