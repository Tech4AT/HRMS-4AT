/**
 * Client for the payroll module API (/api/payroll/* -> backend /api/v1/payroll/*).
 * Every response is `{success, data, meta?}`; failures carry a stable
 * `error.code` (PAY_VERSION_CONFLICT, PAY_PERIOD_LOCKED, ...) and field errors.
 */

export class PayrollApiError extends Error {
  code: string;
  fields: Record<string, string[] | string>;
  details: any;
  status: number;

  constructor(status: number, body: any) {
    const error = body?.error ?? {};
    super(error.message || `Request failed (${status})`);
    this.status = status;
    this.code = error.code || 'ERROR';
    this.fields = error.fields || {};
    this.details = error.details || {};
  }

  /** Human-readable list of field errors, for toasts and form banners. */
  get fieldMessages(): string[] {
    return Object.entries(this.fields).flatMap(([field, value]) => {
      const list = Array.isArray(value) ? value : [String(value)];
      return list.map((msg) => (field === 'nonFieldErrors' || field === 'lines' ? String(msg) : `${field}: ${msg}`));
    });
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: any;
}

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const [route, query] = clean.split('?');
  const url = `/api/payroll/${route}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new PayrollApiError(res.status, json);
  }
  return { data: json.data as T, meta: json.meta };
}

export const payrollApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/** Save a text/CSV payload returned by the API as a file download. */
export function downloadText(fileName: string, content: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function idempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
