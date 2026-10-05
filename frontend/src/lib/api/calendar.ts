/**
 * Browser-side Org Calendar API client. Talks only to the local
 * `/api/calendar/*` route handlers (never the backend directly); those proxy
 * to the backend and carry the httpOnly session cookie.
 *
 * HR-admin-managed calendars. Each calendar owns its holidays, special events,
 * WFH days (one-off dates or a recurring weekday rule, e.g. "every Wednesday")
 * and weekly offs, and applies to the departments and/or employees listed on
 * it. Calendars are independent: there is no default or fallback calendar, and
 * an employee can follow several (the backend combines them additively).
 */

export type CalendarEntryType = 'holiday' | 'wfh' | 'event';

export interface CalendarEntry {
  id: string;
  calendar_id: string;
  type: CalendarEntryType;
  date: string;
  name: string;
  description: string | null;
  /** Holiday flags; always false for events and WFH days. */
  optional: boolean;
  special: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCalendarEntryInput {
  calendar_id: string;
  type: CalendarEntryType;
  date: string;
  name: string;
  description?: string;
  optional?: boolean;
  special?: boolean;
}

export interface UpdateCalendarEntryInput {
  type?: CalendarEntryType;
  date?: string;
  name?: string;
  description?: string | null;
  optional?: boolean;
  special?: boolean;
}

export interface RecurringWfhRule {
  id: string;
  calendar_id: string;
  weekday: number; // 0 = Sunday ... 6 = Saturday
  label: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRecurringWfhRuleInput {
  calendar_id: string;
  weekday: number;
  label?: string;
  active?: boolean;
}

export interface UpdateRecurringWfhRuleInput {
  weekday?: number;
  label?: string;
  active?: boolean;
}

/** Off every week when `weeks` is empty, otherwise only on those occurrences in
 *  the month (1 = first ... 5 = fifth). `weekday`: 0 = Sunday ... 6 = Saturday. */
export interface WeekOffRule {
  weekday: number;
  weeks: number[];
}

export interface Calendar {
  id: string;
  name: string;
  description: string;
  department_ids: string[];
  employee_ids: string[];
  week_offs: WeekOffRule[];
  /** Active people who follow this calendar (listed directly or via department). */
  employee_count: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarInput {
  name: string;
  description: string;
  department_ids: string[];
  employee_ids: string[];
  week_offs: WeekOffRule[];
}

export interface CalendarCoverage {
  active_employees: number;
  unassigned_count: number;
  unassigned: { id: string; name: string; department: string | null }[];
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
  getCalendars: () => request<Calendar[]>('/calendars'),
  createCalendar: (input: CalendarInput) =>
    request<Calendar>('/calendars', { method: 'POST', body: JSON.stringify(input) }),
  updateCalendar: (id: string, input: Partial<CalendarInput>) =>
    request<Calendar>(`/calendars/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteCalendar: (id: string) => request<null>(`/calendars/${id}`, { method: 'DELETE' }),
  getCoverage: () => request<CalendarCoverage>('/calendars/coverage'),

  getEntries: (opts?: { calendarId?: string; from?: string; to?: string; type?: CalendarEntryType }) => {
    const params = new URLSearchParams();
    if (opts?.calendarId) params.set('calendar', opts.calendarId);
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

  getRecurringWfhRules: (calendarId?: string) =>
    request<RecurringWfhRule[]>(`/recurring-wfh${calendarId ? `?calendar=${calendarId}` : ''}`),
  createRecurringWfhRule: (input: CreateRecurringWfhRuleInput) =>
    request<RecurringWfhRule>('/recurring-wfh', { method: 'POST', body: JSON.stringify(input) }),
  updateRecurringWfhRule: (id: string, input: UpdateRecurringWfhRuleInput) =>
    request<RecurringWfhRule>(`/recurring-wfh/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteRecurringWfhRule: (id: string) => request<null>(`/recurring-wfh/${id}`, { method: 'DELETE' }),
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
