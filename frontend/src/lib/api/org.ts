/**
 * Browser-side Org API client. Talks only to the local `/api/*` route
 * handlers (never the backend directly); those proxy to the backend and
 * carry the httpOnly session cookie.
 *
 * The backend returns snake_case `{success, data}` envelopes with `data` as
 * a bare array for these read-only reference lists (see
 * backend/employees/views.py `FrontendEnvelopeMixin`); this client keeps
 * that shape instead of mapping to camelCase.
 */

export interface OrgEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  department_id: string | null;
  designation_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  legal_entity_id: string | null;
  business_unit_id: string | null;
  cost_center_id: string | null;
  status: string;
  employment_type: string;
  date_of_joining: string | null;
  date_of_exit: string | null;
}

export interface NamedEntity {
  id: string;
  name: string;
}

export interface CostCenter {
  id: string;
  name: string;
  code: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class OrgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OrgApiError';
  }
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
    const raw = json?.error?.message;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : raw || `Request failed (${res.status})`;

    // The proxy already cleared the auth cookies — send the user to sign in
    // rather than surfacing a generic error inside the UI.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OrgApiError(message, res.status);
  }

  const data = json.data as T;
  // Defensive: accept either a bare array or a paginated {results} wrapper.
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const results = (data as unknown as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T;
  }
  return data;
}

export function fullName(e: Pick<OrgEmployee, 'first_name' | 'last_name'>): string {
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—';
}

export const orgApi = {
  listEmployees: () => request<OrgEmployee[]>('/api/employees'),
  listDepartments: () => request<NamedEntity[]>('/api/departments'),
  listDesignations: () => request<NamedEntity[]>('/api/designations'),
  listLocations: () => request<NamedEntity[]>('/api/locations'),
  listLegalEntities: () => request<NamedEntity[]>('/api/legal-entities'),
  listBusinessUnits: () => request<NamedEntity[]>('/api/business-units'),
  listCostCenters: () => request<CostCenter[]>('/api/cost-centers'),
};
