export interface CompanyPolicy {
  id: number;
  title: string;
  description: string;
  documentId: number | null;
  documentUrl: string | null;
  requiresAcknowledgment: boolean;
  isActive: boolean;
  createdAt: string;
  acknowledged: boolean;
  acknowledgmentCount: number | null;
}

export interface PolicyAcknowledgment {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  acknowledgedAt: string;
}

export class PoliciesApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PoliciesApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/policies${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    throw new PoliciesApiError(Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`, res.status);
  }
  return json.data as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = (path: string) => request<void>(path, { method: 'DELETE' });

export const policiesApi = {
  list: () => request<CompanyPolicy[]>(''),
  adminList: () => request<CompanyPolicy[]>('/admin-list'),
  create: (input: { title: string; description?: string; documentId?: number | null; requiresAcknowledgment?: boolean }) =>
    post<CompanyPolicy>('', input),
  update: (id: number, input: Partial<{ title: string; description: string; documentId: number | null; requiresAcknowledgment: boolean; isActive: boolean }>) =>
    patch<CompanyPolicy>(`/${id}`, input),
  deactivate: (id: number) => del(`/${id}`),
  acknowledge: (id: number) => post<{ acknowledged: boolean }>(`/${id}/acknowledge`, {}),
  acknowledgments: (id: number) => request<PolicyAcknowledgment[]>(`/${id}/acknowledgments`),
};
