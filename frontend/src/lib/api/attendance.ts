/**
 * Browser-side Attendance API client. Talks only to the local
 * `/api/attendance/*` route handlers (never the NestJS backend directly);
 * those proxy to NestJS and carry the httpOnly session cookie.
 */

export type AttendanceDayStatus =
  | 'present'
  | 'work_from_home'
  | 'half_day'
  | 'on_leave'
  | 'holiday'
  | 'weekend'
  | 'absent'
  | 'not_marked';

export interface AttendanceDayView {
  attendance_date: string;
  status: AttendanceDayStatus;
  check_in: string | null;
  check_out: string | null;
  working_minutes: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  /** Minutes worked beyond the standard workday. */
  overtime_minutes?: number | null;
  is_weekend: boolean;
  is_holiday: boolean;
  holiday_name: string | null;
  holiday_description?: string | null;
  on_leave: boolean;
  leave_type_name: string | null;
  source: string | null;
  notes: string | null;
  record_id: string | null;
  /** Whether a break is currently in progress (today only). */
  on_break?: boolean;
  /** Total break minutes so far today, including any break in progress. */
  break_minutes?: number | null;
  /** Set by the org calendar (a one-off WFH date or an active recurring
   *  weekday rule) - informational only, doesn't change how check-in/out work. */
  is_wfh_day?: boolean;
  /** Name/label of the WFH reason (the one-off entry's name, or the
   *  recurring rule's label), when `is_wfh_day` is true. */
  wfh_note?: string | null;
  /** Description of the one-off WFH entry, if it has one. */
  wfh_description?: string | null;
  /** Special calendar events on this date. */
  events?: { name: string; description: string | null }[];
}

export interface AttendanceSummary {
  from: string;
  to: string;
  elapsed_days: number;
  total_days: number;
  weekend_days: number;
  holiday_days: number;
  working_days: number;
  present_days: number;
  leave_days: number;
  absent_days: number;
  late_days: number;
  early_leave_days: number;
  total_working_minutes: number;
  total_working_hours: number;
  overtime_minutes: number;
}

export interface AttendanceRecord {
  id: string;
  organization_id: string;
  employee_id: string;
  attendance_date: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  working_minutes: number | null;
  break_minutes?: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  status: string;
  source: string;
  notes: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceWindow {
  month?: string;
  from?: string;
  to?: string;
}

export type AttendanceRequestType = 'wfh' | 'regularisation';
export type AttendanceRequestStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface AttendanceRequest {
  id: string;
  employee_id: string;
  request_type: AttendanceRequestType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: AttendanceRequestStatus;
  approver_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  employee_name?: string | null;
  approver_name?: string | null;
  approver_remarks?: string | null;
}

export interface CreateWfhRequestInput {
  start_date: string;
  end_date: string;
  reason: string;
}

/** A regularisation request marks one whole day Present — no clock times. */
export interface CreateRegularisationRequestInput {
  start_date: string;
  reason: string;
}

/** Only a pending regularisation request can be edited. */
export interface UpdateRegularisationRequestInput {
  start_date?: string;
  reason?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class AttendanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AttendanceApiError';
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
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : raw || `Request failed (${res.status})`;

    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new AttendanceApiError(message, res.status);
  }

  return json.data as T;
}

function windowQuery(w: AttendanceWindow): string {
  const params = new URLSearchParams();
  if (w.month) params.set('month', w.month);
  if (w.from) params.set('from', w.from);
  if (w.to) params.set('to', w.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const attendanceApi = {
  getToday: () => request<AttendanceDayView>('/today'),
  getHistory: (w: AttendanceWindow) => request<AttendanceDayView[]>(windowQuery(w)),
  getSummary: (w: AttendanceWindow) => request<AttendanceSummary>(`/summary${windowQuery(w)}`),
  checkIn: (notes?: string) =>
    request<AttendanceRecord>('/check-in', {
      method: 'POST',
      body: JSON.stringify(notes ? { notes } : {}),
    }),
  checkOut: (notes?: string) =>
    request<AttendanceRecord>('/check-out', {
      method: 'POST',
      body: JSON.stringify(notes ? { notes } : {}),
    }),
  startBreak: () => request<AttendanceDayView>('/break-start', { method: 'POST', body: '{}' }),
  endBreak: () => request<AttendanceDayView>('/break-end', { method: 'POST', body: '{}' }),

  // ----- WFH / regularisation requests -----------------------------------
  getRequests: (type?: AttendanceRequestType) =>
    request<AttendanceRequest[]>(`/requests${type ? `?type=${type}` : ''}`),
  requestWfh: (input: CreateWfhRequestInput) =>
    request<AttendanceRequest>('/requests', {
      method: 'POST',
      body: JSON.stringify({ request_type: 'wfh', ...input }),
    }),
  requestRegularisation: (input: CreateRegularisationRequestInput) =>
    request<AttendanceRequest>('/requests', {
      method: 'POST',
      body: JSON.stringify({ request_type: 'regularisation', ...input }),
    }),
  cancelRequest: (id: string) =>
    request<AttendanceRequest>(`/requests/${id}/cancel`, { method: 'POST' }),
  /** Only a pending ('submitted') regularisation request can be edited. */
  updateRequest: (id: string, input: UpdateRegularisationRequestInput) =>
    request<AttendanceRequest>(`/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  getPendingApprovals: () => request<AttendanceRequest[]>('/requests/approvals/pending'),
  getApprovalHistory: () => request<AttendanceRequest[]>('/requests/approvals/history'),
  decideRequest: (id: string, approve: boolean, rejectionReason?: string, remarks?: string) =>
    request<AttendanceRequest>(`/requests/${id}/approve`, {
      method: 'PUT',
      body: JSON.stringify(
        approve
          ? { approve: true, remarks }
          : { approve: false, rejection_reason: rejectionReason, remarks },
      ),
    }),
};
