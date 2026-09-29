/**
 * Browser-side Penalisation API client. Talks to the real backend built for
 * PLAN.md Step 8 (`attendance/penalisation_views.py`) via the local
 * `/api/attendance/penalisations*` proxy.
 *
 * Two audiences, two endpoints — not one shared client function with a
 * permission branch, matching the backend split (`PenalisationViewSet` vs
 * `MyPenalisationsView`): `getMine()` is self-service, read-only, no
 * `penalisation.manage` needed; `getAll()`/`overturn()` are HR-only.
 *
 * No pre-existing wire contract before this (the old `PenalisationRecord` in
 * `lib/attendance/penalisation.ts` was sample-only, localStorage-backed), so
 * the backend uses the project's default camelCase renderer/parser directly.
 * `leaveDaysDeducted` is a Decimal field though (added post-Step-8, when a
 * Penalisation started actually consuming leave), so it comes back as a
 * string same as everywhere else this codebase has a Decimal on the wire —
 * converted here, same pattern as leaveBalanceAdmin.ts.
 */

export type PenalisationStatus = 'applied' | 'overturned';

export interface PenalisationRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  absentDate: string;
  regularisationDeadline: string;
  daysOverdue: number;
  reason: string;
  status: PenalisationStatus;
  leaveDaysDeducted: number;
  overturnedBy: string | null;
  overturnedReason: string;
}

interface RawPenalisationRecord extends Omit<PenalisationRecord, 'leaveDaysDeducted'> {
  leaveDaysDeducted: string;
}

function toPenalisationRecord(raw: RawPenalisationRecord): PenalisationRecord {
  return { ...raw, leaveDaysDeducted: Number(raw.leaveDaysDeducted) };
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string | string[] };
}

export class PenalisationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PenalisationApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/attendance/penalisations${path}`, {
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
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new PenalisationApiError(message, res.status);
  }

  return json.data as T;
}

export const penalisationApi = {
  /** The caller's own records only — read-only, no `penalisation.manage` needed. */
  getMine: async () => (await request<RawPenalisationRecord[]>('/mine')).map(toPenalisationRecord),
  /** Every employee's records — `penalisation.manage` only. */
  getAll: async (status?: PenalisationStatus) =>
    (await request<RawPenalisationRecord[]>(status ? `?status=${status}` : '')).map(
      toPenalisationRecord,
    ),
  /** Overturns an Applied record directly — `penalisation.manage` only. */
  overturn: async (id: string, reason: string) =>
    toPenalisationRecord(
      await request<RawPenalisationRecord>(`/${id}/overturn`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    ),
};
