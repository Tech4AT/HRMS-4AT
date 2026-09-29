/**
 * Browser-side Org Calendar API client. Talks only to the local
 * `/api/calendar/*` route handlers (never the backend directly); those proxy
 * to the backend and carry the httpOnly session cookie.
 *
 * This is the HR-admin-managed, org-wide calendar: holidays, special events,
 * and WFH days (one-off dates or a recurring weekday rule, e.g. "every
 * Wednesday"). Every employee's attendance view reads the same data, so a
 * change here applies to everyone.
 */

export type CalendarEntryType = 'holiday' | 'wfh' | 'event';

export interface CalendarEntry {
  id: string;
  type: CalendarEntryType;
  date: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCalendarEntryInput {
  type: CalendarEntryType;
  date: string;
  name: string;
  description?: string;
}

export interface UpdateCalendarEntryInput {
  type?: CalendarEntryType;
  date?: string;
  name?: string;
  description?: string | null;
}

export interface RecurringWfhRule {
  id: string;
  weekday: number; // 0 = Sunday ... 6 = Saturday
  label: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRecurringWfhRuleInput {
  weekday: number;
  label?: string;
  active?: boolean;
}

export interface UpdateRecurringWfhRuleInput {
  weekday?: number;
  label?: string;
  active?: boolean;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class CalendarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CalendarApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/calendar${path}`, {
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
    throw new CalendarApiError(message, res.status);
  }

  return json.data as T;
}

export const calendarApi = {
  getEntries: (opts?: { from?: string; to?: string; type?: CalendarEntryType }) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.type) params.set('type', opts.type);
    const qs = params.toString();
    return request<CalendarEntry[]>(`/entries${qs ? `?${qs}` : ''}`);
  },
  createEntry: (input: CreateCalendarEntryInput) =>
    request<CalendarEntry>('/entries', { method: 'POST', body: JSON.stringify(input) }),
  updateEntry: (id: string, input: UpdateCalendarEntryInput) =>
    request<CalendarEntry>(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteEntry: (id: string) => request<null>(`/entries/${id}`, { method: 'DELETE' }),

  getRecurringWfhRules: () => request<RecurringWfhRule[]>('/recurring-wfh'),
  createRecurringWfhRule: (input: CreateRecurringWfhRuleInput) =>
    request<RecurringWfhRule>('/recurring-wfh', { method: 'POST', body: JSON.stringify(input) }),
  updateRecurringWfhRule: (id: string, input: UpdateRecurringWfhRuleInput) =>
    request<RecurringWfhRule>(`/recurring-wfh/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteRecurringWfhRule: (id: string) => request<null>(`/recurring-wfh/${id}`, { method: 'DELETE' }),
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
