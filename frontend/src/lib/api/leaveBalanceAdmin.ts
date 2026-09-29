/**
 * Browser-side Leave Balances (admin) API client. Talks to the real backend
 * built for Settings > Leave Settings > Leave Balances
 * (`leave/balance_admin.py::LeaveBalanceAdminViewSet`) via the local
 * `/api/leave/balances/admin` proxy. Distinct from `leaveApi.getBalance()`
 * (self-service, "my own balances") — this is the HR-wide read + correction
 * view across every employee.
 *
 * No pre-existing wire contract here (`LeaveBalancesPanel.tsx` was pure local
 * sample state before this), so — like `shifts.ts`/`policySettings.ts` — this
 * uses the project's default camelCase renderer/parser directly; numeric
 * fields still come back as strings (Decimal fields), converted here.
 */

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string | string[] };
}

export class LeaveBalanceAdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LeaveBalanceAdminApiError';
  }
}

interface RawLeaveType {
  id: string;
  name: string;
  annualAllocation: string;
}

interface RawBalance {
  leaveTypeId: string;
  used: string;
  allocated: string;
  carryForward: string;
  entitled: string;
  available: string;
}

interface RawEmployee {
  id: string;
  name: string;
  employeeCode: string;
  businessUnit: string | null;
  department: string | null;
  location: string | null;
  balances: RawBalance[];
}

interface RawData {
  leaveTypes: RawLeaveType[];
  employees: RawEmployee[];
}

export interface LeaveBalanceAdminType {
  id: string;
  name: string;
  annualAllocation: number;
}

export interface LeaveBalanceAdminBalance {
  leaveTypeId: string;
  used: number;
  allocated: number;
  carryForward: number;
  entitled: number;
  available: number;
}

export interface LeaveBalanceAdminEmployee {
  id: string;
  name: string;
  employeeCode: string;
  businessUnit: string | null;
  department: string | null;
  location: string | null;
  balances: LeaveBalanceAdminBalance[];
}

export interface LeaveBalancesAdminData {
  leaveTypes: LeaveBalanceAdminType[];
  employees: LeaveBalanceAdminEmployee[];
}

function toBalance(raw: RawBalance): LeaveBalanceAdminBalance {
  return {
    leaveTypeId: raw.leaveTypeId,
    used: Number(raw.used),
    allocated: Number(raw.allocated),
    carryForward: Number(raw.carryForward),
    entitled: Number(raw.entitled),
    available: Number(raw.available),
  };
}

function toEmployee(raw: RawEmployee): LeaveBalanceAdminEmployee {
  return { ...raw, balances: raw.balances.map(toBalance) };
}

function toData(raw: RawData): LeaveBalancesAdminData {
  return {
    leaveTypes: raw.leaveTypes.map((t) => ({ ...t, annualAllocation: Number(t.annualAllocation) })),
    employees: raw.employees.map(toEmployee),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/leave/balances/admin${path}`, {
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
    throw new LeaveBalanceAdminApiError(message, res.status);
  }

  return json.data as T;
}

export const leaveBalanceAdminApi = {
  list: async (): Promise<LeaveBalancesAdminData> => toData(await request<RawData>('')),
  updateEmployeeBalances: async (
    employeeId: string,
    balances: { leaveTypeId: string; used: number }[],
  ): Promise<LeaveBalanceAdminEmployee> =>
    toEmployee(
      await request<RawEmployee>(`/${employeeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ balances }),
      }),
    ),
};
