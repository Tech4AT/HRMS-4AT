/**
 * Browser-side Org Changes API client. Talks only to the local
 * `/api/org-changes/*` route handlers (never the backend directly); those
 * proxy to the backend and carry the httpOnly session cookie.
 *
 * The backend renders snake_case `{success, data}` envelopes (see
 * backend/orgchanges/serializers.py); this client keeps that shape instead
 * of mapping to camelCase.
 */

import { OrgApiError } from './org';

export type OrgChangeType =
  | 'promotion'
  | 'dept_transfer'
  | 'location_transfer'
  | 'position_change'
  | 'manager_change';

export type OrgChangeStatus = 'pending' | 'effective' | 'cancelled';

export interface OrgChange {
  id: string;
  employee_id: string;
  change_type: OrgChangeType;
  from_data: Record<string, unknown>;
  to_data: Record<string, unknown>;
  effective_date: string;
  status: OrgChangeStatus;
  changed_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgChangeListParams {
  change_type?: OrgChangeType;
  status?: OrgChangeStatus | '';
  employee?: string;
}

export interface OrgChangeCreate {
  employee_id: string;
  change_type: OrgChangeType;
  from_data?: Record<string, unknown>;
  to_data: Record<string, unknown>;
  effective_date: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

function errorMessage(json: Envelope<unknown> | null, status: number): string {
  const raw = json?.error?.message;
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string' && raw) return raw;
  return `Request failed (${status})`;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }
  if (!res.ok || !json?.success) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OrgApiError(errorMessage(json, res.status), res.status);
  }
  const data = json.data as T;
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const results = (data as unknown as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T;
  }
  return data;
}

async function mutate<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }
  if (!res.ok || !json?.success) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OrgApiError(errorMessage(json, res.status), res.status);
  }
  return json.data as T;
}

function query(params: OrgChangeListParams): string {
  const qs = new URLSearchParams();
  if (params.change_type) qs.set('change_type', params.change_type);
  if (params.status) qs.set('status', params.status);
  if (params.employee) qs.set('employee', params.employee);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const orgChangesApi = {
  list: (params: OrgChangeListParams = {}) =>
    request<OrgChange[]>(`/api/org-changes/org-changes/${query(params)}`),
  get: (id: string) => request<OrgChange>(`/api/org-changes/org-changes/${id}/`),
  create: (payload: OrgChangeCreate) =>
    mutate<OrgChange>('/api/org-changes/org-changes/', 'POST', payload),
  /** Cancelling is a PATCH to `cancelled`; effective rows are history. */
  cancel: (id: string) =>
    mutate<OrgChange>(`/api/org-changes/org-changes/${id}/`, 'PATCH', { status: 'cancelled' }),
};

export const ORG_CHANGE_TYPE_LABELS: Record<OrgChangeType, string> = {
  promotion: 'Promotion',
  dept_transfer: 'Department transfer',
  location_transfer: 'Location transfer',
  position_change: 'Position change',
  manager_change: 'Manager change',
};
