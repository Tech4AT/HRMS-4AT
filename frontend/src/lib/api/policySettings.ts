/**
 * Browser-side Policy Settings API client. Talks to the real backend built in
 * PLAN.md Step 6 (`attendance/settings_views.py::PolicySettingsView`) via the
 * local `/api/attendance/policy-settings` proxy — a singleton, GET reads it,
 * PUT replaces it wholesale.
 *
 * The wire shape is nested like `PenalizationSettings` already is
 * (`noAttendance: {enabled, leaveDaysDeducted, ...}`), but every rule shares
 * one shape server-side (`thresholdCount`/`minWorkHours` always present,
 * `null` when a rule doesn't use them) and numeric fields come back as
 * strings (Decimal fields) — both translated here so the rest of the app
 * keeps using the exact `PenalizationSettings` shape it already had with
 * localStorage.
 */

import type { CompOffAccrualConfig, PenalisationRuleConfig, PenalizationSettings } from '@/lib/attendance/penalisation';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string | string[] };
}

export class PolicySettingsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PolicySettingsApiError';
  }
}

interface RawRuleConfig {
  enabled: boolean;
  leaveDaysDeducted: string;
  thresholdCount: number | null;
  minWorkHours: string | null;
}

interface RawCompOffAccrual {
  enabled: boolean;
  overtimeHoursPerCompOff: string;
}

interface RawPolicySettings {
  regularisationGraceDays: number;
  abscondingThresholdDays: number;
  penaltyLeaveTypeId: string | null;
  compOffLeaveTypeId: string | null;
  noAttendance: RawRuleConfig;
  lateArrival: RawRuleConfig;
  earlyLeaving: RawRuleConfig;
  workHours: RawRuleConfig;
  compOffAccrual: RawCompOffAccrual;
}

function toRuleConfig(raw: RawRuleConfig): PenalisationRuleConfig {
  return {
    enabled: raw.enabled,
    leaveDaysDeducted: Number(raw.leaveDaysDeducted),
    ...(raw.thresholdCount != null ? { thresholdCount: raw.thresholdCount } : {}),
    ...(raw.minWorkHours != null ? { minWorkHours: Number(raw.minWorkHours) } : {}),
  };
}

function toCompOffAccrual(raw: RawCompOffAccrual): CompOffAccrualConfig {
  return { enabled: raw.enabled, overtimeHoursPerCompOff: Number(raw.overtimeHoursPerCompOff) };
}

function toPolicySettings(raw: RawPolicySettings): PenalizationSettings {
  return {
    regularisationGraceDays: raw.regularisationGraceDays,
    abscondingThresholdDays: raw.abscondingThresholdDays,
    penaltyLeaveTypeId: raw.penaltyLeaveTypeId,
    compOffLeaveTypeId: raw.compOffLeaveTypeId,
    noAttendance: toRuleConfig(raw.noAttendance),
    lateArrival: toRuleConfig(raw.lateArrival),
    earlyLeaving: toRuleConfig(raw.earlyLeaving),
    workHours: toRuleConfig(raw.workHours),
    compOffAccrual: toCompOffAccrual(raw.compOffAccrual),
  };
}

async function request<T>(init?: RequestInit): Promise<T> {
  const res = await fetch('/api/attendance/policy-settings', {
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
    throw new PolicySettingsApiError(message, res.status);
  }

  return json.data as T;
}

export const policySettingsApi = {
  get: async (): Promise<PenalizationSettings> => toPolicySettings(await request<RawPolicySettings>()),
  update: async (settings: PenalizationSettings): Promise<PenalizationSettings> =>
    toPolicySettings(
      await request<RawPolicySettings>({ method: 'PUT', body: JSON.stringify(settings) }),
    ),
};
