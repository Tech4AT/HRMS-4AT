/**
 * Browser-side Team Attendance API client (PLAN.md Step 9) — the Dashboard's
 * real, scoped read shape. Talks to `/api/attendance/team/daily`, which
 * returns one row per (employee in the caller's manageable scope, date in the
 * requested window) — the caller's own manager's-eye view (direct reports) or
 * an HR Admin's org-wide view, resolved server-side via the same
 * `core.scope.resolve_employee_scope` every other scoped read in this app
 * uses (PLAN.md Step 9 explicitly says not to reinvent that).
 *
 * Reuses the exact same day-view shape (`AttendanceDayView`) the self-service
 * `/attendance` history endpoint already returns, extended with
 * employee_id/employee_name/department — the only genuinely new fields a
 * multi-employee view needs. Snake_case on the wire (the backend's
 * `FrontendEnvelopeMixin`-style plain renderer, matching the existing
 * attendance/leave/calendar contract), not the camelCase Shift/PolicySettings/
 * Penalisation use — this endpoint is built on the *existing* day-view shape,
 * not a fresh one.
 */

import type { AttendanceDayView } from './attendance';

export interface TeamAttendanceDayView extends AttendanceDayView {
  employee_id: string;
  employee_name: string;
  department: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string | string[] };
}

export class TeamAttendanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TeamAttendanceApiError';
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api/attendance/team/${path}`, { credentials: 'include' });

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
    throw new TeamAttendanceApiError(message, res.status);
  }

  return json.data as T;
}

export const teamAttendanceApi = {
  /** Every employee in the caller's scope, for every date in [from, to]
   *  (inclusive), one row each. Empty array (not an error) if the caller's
   *  scope resolves to nobody. */
  getDaily: (from: string, to: string) =>
    request<TeamAttendanceDayView[]>(`daily?from=${from}&to=${to}`),

  /** My Team: one group of the caller's own team, at the detail level the
   *  backend allows for each person. */
  getSummary: (group: TeamGroup, month?: string) =>
    request<TeamSummary>(`summary?group=${group}${month ? `&month=${month}` : ''}`),
};

export type TeamGroup = 'direct' | 'indirect' | 'peers';

/** `in` / `not_in` is all a person outside the caller's manageable scope reveals;
 *  `day_off` is an organisation-wide fact (holiday or week off), not about them. */
export type Presence = 'in' | 'not_in' | 'day_off';

export interface TeamSummaryMember {
  employee_id: string;
  /** `detail`: the caller may read this person's full day (rows below).
   *  `basic`: presence only. */
  level: 'detail' | 'basic';
  presence: Presence;
}

export interface TeamSummary {
  group: TeamGroup;
  /** Today, in the organisation's calendar. */
  date: string;
  month: string;
  /** False when the caller has no reporting manager (so no peers). */
  has_manager: boolean;
  /** `total` people in the group; the caller may read `detail` of them in full. */
  coverage: { total: number; detail: number };
  members: TeamSummaryMember[];
  /** Full day views for `detail` members: the requested month, plus today. */
  rows: TeamAttendanceDayView[];
}
