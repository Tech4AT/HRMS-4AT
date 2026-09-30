/**
 * Browser-side Leave API client. Talks only to the local `/api/leave/*` route
 * handlers (never the NestJS backend directly); those proxy to NestJS and carry
 * the httpOnly session cookie.
 */

export type HalfDayOption = 'full_day' | 'first_half' | 'second_half';
export type LeaveStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  category: string;
  annual_allocation: number;
  carry_forward_limit: number;
  requires_approval: boolean;
  is_paid: boolean;
  description: string | null;
  /** 'active' types can be picked for new requests; 'inactive' ones are retired
   *  but keep every balance and request. */
  status: string;
  /** How many balances / requests use this type. Only sent to people who manage
   *  leave settings (null for everyone else). */
  balance_count: number | null;
  request_count: number | null;
}

/** What a permanent purge erased. */
export interface LeaveTypePurgeResult {
  id: string;
  balances: number;
  requests: number;
  approvals: number;
}

/** The backend's actual wire shape for `LeaveType`/`LeaveBalanceItem`/
 *  `LeaveRequest` below — `DecimalField`s (`annual_allocation`,
 *  `carry_forward_limit`, every `LeaveBalanceItem` money-like field,
 *  `duration_days`) serialize as JSON *strings* by DRF default
 *  (`COERCE_DECIMAL_TO_STRING`, unset here so it stays the default `True` —
 *  the same reason `lib/api/policySettings.ts` and `lib/api/leaveBalanceAdmin.ts`
 *  convert at this same boundary), not numbers. Calling `.toFixed()` on one of
 *  these straight off the wire throws ("n.toFixed is not a function") — the
 *  `toLeaveType`/`toLeaveBalanceItem`/`toLeaveRequest` converters below exist
 *  so every other component in this app can keep treating these fields as
 *  plain numbers, as their types already promise. */
type RawLeaveType = Omit<LeaveType, 'annual_allocation' | 'carry_forward_limit'> & {
  annual_allocation: string;
  carry_forward_limit: string;
};

function toLeaveType(raw: RawLeaveType): LeaveType {
  return {
    ...raw,
    annual_allocation: Number(raw.annual_allocation),
    carry_forward_limit: Number(raw.carry_forward_limit),
  };
}

export interface LeaveTypeInput {
  name: string;
  category: string;
  annual_allocation: number;
  carry_forward_limit: number;
  requires_approval: boolean;
  is_paid: boolean;
  description?: string;
}

export interface LeaveBalanceItem {
  id: string;
  leave_type_id: string;
  financial_year: string;
  opening_balance: number;
  allocated: number;
  used: number;
  pending: number;
  carry_forward: number;
  lapsed: number;
  entitled: number;
  available: number;
}

type RawLeaveBalanceItem = Omit<
  LeaveBalanceItem,
  'opening_balance' | 'allocated' | 'used' | 'pending' | 'carry_forward' | 'lapsed' | 'entitled' | 'available'
> & {
  opening_balance: string;
  allocated: string;
  used: string;
  pending: string;
  carry_forward: string;
  lapsed: string;
  entitled: string;
  available: string;
};

function toLeaveBalanceItem(raw: RawLeaveBalanceItem): LeaveBalanceItem {
  return {
    ...raw,
    opening_balance: Number(raw.opening_balance),
    allocated: Number(raw.allocated),
    used: Number(raw.used),
    pending: Number(raw.pending),
    carry_forward: Number(raw.carry_forward),
    lapsed: Number(raw.lapsed),
    entitled: Number(raw.entitled),
    available: Number(raw.available),
  };
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  half_day_option: HalfDayOption;
  reason: string | null;
  status: LeaveStatus;
  approver_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  leave_type_name: string | null;
  leave_type_code: string | null;
  employee_name: string | null;
  approver_name: string | null;
  /** Who actually decided this — usually the same as approver_name, but not
   *  when an HR Admin resolved it via the approvals.manage override instead
   *  of the assigned approver deciding it themselves. Use this, not
   *  approver_name, for a "decided by" display. */
  decided_by_name?: string | null;
  approver_remarks?: string | null;
  /** The generic approvals engine's own request id — decide through
   *  requestsApi.approve/reject(this id), never a per-module endpoint. */
  approval_request_id?: string | null;
}

type RawLeaveRequest = Omit<LeaveRequest, 'duration_days'> & { duration_days: string };

function toLeaveRequest(raw: RawLeaveRequest): LeaveRequest {
  return { ...raw, duration_days: Number(raw.duration_days) };
}

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  is_optional: boolean;
  description: string | null;
}

export interface CreateLeaveRequestInput {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  half_day_option?: HalfDayOption;
  reason?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class LeaveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LeaveApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/leave${path}`, {
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

    // The proxy already cleared the auth cookies — send the user to sign in
    // rather than surfacing a generic error inside the UI.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new LeaveApiError(message, res.status);
  }

  return json.data as T;
}

export const leaveApi = {
  getTypes: async () => (await request<RawLeaveType[]>('/types')).map(toLeaveType),
  createType: async (input: LeaveTypeInput) =>
    toLeaveType(await request<RawLeaveType>('/types', { method: 'POST', body: JSON.stringify(input) })),
  updateType: async (id: string, input: Partial<LeaveTypeInput>) =>
    toLeaveType(
      await request<RawLeaveType>(`/types/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    ),
  /** Deactivate ('inactive') or reactivate ('active') a type without touching its history. */
  setTypeStatus: async (id: string, status: 'active' | 'inactive') =>
    toLeaveType(
      await request<RawLeaveType>(`/types/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    ),
  /** Only succeeds for a type nothing uses; otherwise the backend answers 409. */
  deleteType: (id: string) => request<{ id: string }>(`/types/${id}`, { method: 'DELETE' }),
  /** Irreversible: erases the type and every balance and request that uses it.
   *  The backend requires the type's exact name as confirmation. */
  purgeType: (id: string, confirmName: string) =>
    request<LeaveTypePurgeResult>(`/types/${id}/purge`, {
      method: 'POST',
      body: JSON.stringify({ confirm_name: confirmName }),
    }),
  getBalance: async () => (await request<RawLeaveBalanceItem[]>('/balance')).map(toLeaveBalanceItem),
  getRequests: async () => (await request<RawLeaveRequest[]>('/requests')).map(toLeaveRequest),
  getRequest: async (id: string) => toLeaveRequest(await request<RawLeaveRequest>(`/requests/${id}`)),
  createRequest: async (input: CreateLeaveRequestInput) =>
    toLeaveRequest(
      await request<RawLeaveRequest>('/requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  cancelRequest: async (id: string) =>
    toLeaveRequest(await request<RawLeaveRequest>(`/requests/${id}/cancel`, { method: 'POST' })),
  getPendingApprovals: async () =>
    (await request<RawLeaveRequest[]>('/approvals/pending')).map(toLeaveRequest),
  getApprovalHistory: async () =>
    (await request<RawLeaveRequest[]>('/approvals/history')).map(toLeaveRequest),
  decide: async (id: string, approve: boolean, rejectionReason?: string, remarks?: string) =>
    toLeaveRequest(
      await request<RawLeaveRequest>(`/requests/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify(
          approve
            ? { approve: true, remarks }
            : { approve: false, rejection_reason: rejectionReason, remarks },
        ),
      }),
    ),
  getHolidays: (year: number) => request<Holiday[]>(`/holidays?year=${year}`),
  getCalendar: async (from: string, to: string) =>
    (await request<RawLeaveRequest[]>(`/calendar?from=${from}&to=${to}`)).map(toLeaveRequest),
};

// ---- small formatting helpers shared by the leave UI ----

export function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatDateShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateRange(
  start: string,
  end: string,
  half: HalfDayOption,
): string {
  const suffix =
    half === 'first_half'
      ? ' · First half'
      : half === 'second_half'
        ? ' · Second half'
        : '';
  if (start === end) return `${formatDateShort(start)}${suffix}`;
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

const STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: 'Draft',
  submitted: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function statusLabel(s: LeaveStatus): string {
  return STATUS_LABEL[s] ?? s;
}
