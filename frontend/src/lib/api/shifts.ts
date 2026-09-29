/**
 * Browser-side Shifts API client. Talks only to the local `/api/attendance/*`
 * route handler (never the backend directly); it proxies to the real backend
 * built in PLAN.md Step 6 (`attendance/settings_views.py`).
 *
 * Unlike leave/attendance/calendar, this endpoint has no legacy snake_case
 * wire contract to match — the backend uses the project's default CamelCase
 * renderer, so these field names are exactly what the backend returns with no
 * translation layer needed.
 */

export interface Shift {
  id: string;
  name: string;
  /** 24h "HH:MM". `endTime` earlier than `startTime` means an overnight shift. */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  employeeIds: string[];
}

export interface ShiftInput {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  employeeIds: string[];
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class ShiftsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ShiftsApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/attendance${path}`, {
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
    throw new ShiftsApiError(message, res.status);
  }

  return json.data as T;
}

export const shiftsApi = {
  getShifts: () => request<Shift[]>('/shifts'),
  createShift: (input: ShiftInput) =>
    request<Shift>('/shifts', { method: 'POST', body: JSON.stringify(input) }),
  updateShift: (id: string, input: ShiftInput) =>
    request<Shift>(`/shifts/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteShift: (id: string) => request<null>(`/shifts/${id}`, { method: 'DELETE' }),
};

export function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Net working hours (gross span minus break), handling overnight shifts
 *  where `endTime` wraps past midnight. */
export function shiftWorkingMinutes(shift: Pick<Shift, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let span = eh * 60 + em - (sh * 60 + sm);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - shift.breakMinutes);
}

export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
