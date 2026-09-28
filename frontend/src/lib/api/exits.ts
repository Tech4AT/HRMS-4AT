/** Resignation / exit API — `/api/exits/*` proxies to Django `/exits/*`. */

export type ResignationStatus = 'submitted' | 'accepted' | 'rejected' | 'withdrawn' | 'completed';

export interface Resignation {
  id: number;
  employee: {
    id: number;
    name: string;
    employeeCode: string;
    workEmail: string;
    department: string | null;
    designation: string | null;
    status: string;
  };
  reason: string;
  requestedLastDay: string;
  lastWorkingDay: string | null;
  status: ResignationStatus;
  statusDisplay: string;
  initiatedByHr: boolean;
  hrNotes: string;
  submittedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  completedAt: string | null;
}

export interface MyResignationState {
  resignation: Resignation | null;
  noticePeriodDays: number;
  suggestedLastDay: string;
  canResign: boolean;
}

export const RESIGNATION_STATUS_COLOR: Record<ResignationStatus, string> = {
  submitted: 'bg-amber-100 text-amber-700',
  accepted: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-600',
  completed: 'bg-slate-200 text-slate-700',
};

export class ExitsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ExitsApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/exits${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    throw new ExitsApiError(Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`, res.status);
  }
  return json.data as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const exitsApi = {
  mine: () => request<MyResignationState | null>('/mine'),
  resign: (input: { reason: string; requestedLastDay: string }) => post<Resignation>('/mine', input),
  withdraw: () => post<Resignation>('/mine/withdraw', {}),
  list: (status?: string) => request<Resignation[]>(`/resignations${status ? `?status=${status}` : ''}`),
  accept: (id: number, input: { lastWorkingDay: string; notes?: string }) => post<Resignation>(`/resignations/${id}/accept`, input),
  reject: (id: number, notes: string) => post<Resignation>(`/resignations/${id}/reject`, { notes }),
  initiate: (input: { employeeId: number; lastWorkingDay: string; reason: string }) => post<Resignation>('/initiate', input),
};
