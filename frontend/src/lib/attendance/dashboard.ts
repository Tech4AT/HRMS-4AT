/** Real, scoped data behind the Attendance & Leave Dashboard tab (PLAN.md
 *  Step 9). Aggregates the rows `teamAttendanceApi.getDaily()` returns (one
 *  row per employee per day, already scoped server-side to the caller's
 *  manageable roster) into the shapes the Dashboard/Leaderboard render.
 *  Replaces the fully-synthetic per-employee-per-day generator that used to
 *  live here (`sample-employees.ts`, now removed) - the date-utility
 *  functions below (`toLocalISODate`, `lastNDays`, `periodDays`) are the only
 *  parts of the old module that had nothing to do with the fake roster and
 *  so didn't need replacing. */

import { isoToHM } from './view';
import type { TeamAttendanceDayView } from '@/lib/api/teamAttendance';

export type DailyStatus = 'present' | 'late' | 'on_leave' | 'wfh' | 'absent' | 'day_off' | 'not_marked';

export interface EmployeeDayStatus {
  employeeId: string;
  employeeName: string;
  department: string | null;
  status: DailyStatus;
  checkIn?: string;
  leaveType?: string;
}

/** Maps the real day-view's richer status/facts down to the Dashboard's
 *  simpler display buckets. **Judgment calls, flagged as such, not dictated
 *  by any existing UI** (the old sample data modelled none of this): a
 *  holiday/weekend buckets as 'day_off' - a new bucket, excluded from
 *  percentage-of-workforce KPIs rather than counted as an absence, since
 *  nobody was expected to work; 'not_marked' (today only - a past day with no
 *  record already resolves to 'absent' server-side) is its own bucket too,
 *  rather than folded into 'absent', since the day isn't over yet; a WFH day
 *  always buckets as 'wfh' even if also late, since WFH is the more salient
 *  signal for an org-wide dashboard. */
export function statusFor(row: TeamAttendanceDayView): EmployeeDayStatus {
  const base = { employeeId: row.employee_id, employeeName: row.employee_name, department: row.department };

  if (row.is_holiday || row.is_weekend) return { ...base, status: 'day_off' };
  if (row.status === 'on_leave') return { ...base, status: 'on_leave', leaveType: row.leave_type_name ?? undefined };
  if (row.status === 'not_marked') return { ...base, status: 'not_marked' };

  const checkIn = row.check_in ? isoToHM(row.check_in) : undefined;
  if (row.status === 'work_from_home') return { ...base, status: 'wfh', checkIn };
  if (row.status === 'present' || row.status === 'half_day') {
    return { ...base, status: (row.late_minutes ?? 0) > 0 ? 'late' : 'present', checkIn };
  }
  return { ...base, status: 'absent' };
}

export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function lastNDays(n: number, from = new Date()): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    days.push(toLocalISODate(d));
  }
  return days;
}

export interface DayAttendanceAggregate {
  date: string;
  present: number;
  late: number;
  onLeave: number;
  wfh: number;
  absent: number;
  dayOff: number;
  notMarked: number;
  total: number;
}

export function aggregateForDay(rows: TeamAttendanceDayView[], dateStr: string): DayAttendanceAggregate {
  const statuses = rows.filter((r) => r.attendance_date === dateStr).map(statusFor);
  const count = (s: DailyStatus) => statuses.filter((x) => x.status === s).length;
  return {
    date: dateStr,
    present: count('present'),
    late: count('late'),
    onLeave: count('on_leave'),
    wfh: count('wfh'),
    absent: count('absent'),
    dayOff: count('day_off'),
    notMarked: count('not_marked'),
    total: statuses.length,
  };
}

export type Period = 'thisWeek' | 'lastWeek' | 'thisMonth';

export const PERIOD_LABEL: Record<Period, string> = {
  thisWeek: 'This Week',
  lastWeek: 'Last Week',
  thisMonth: 'This Month',
};

export function periodDays(period: Period, from = new Date()): string[] {
  if (period === 'thisWeek') return lastNDays(7, from);
  if (period === 'lastWeek') {
    const anchor = new Date(from);
    anchor.setDate(anchor.getDate() - 7);
    return lastNDays(7, anchor);
  }
  const days: string[] = [];
  const first = new Date(from.getFullYear(), from.getMonth(), 1);
  for (const d = new Date(first); d <= from; d.setDate(d.getDate() + 1)) {
    days.push(toLocalISODate(d));
  }
  return days;
}

export interface EmployeePeriodMetrics {
  employeeId: string;
  employeeName: string;
  department: string | null;
  totalHours: number;
  overtimeHours: number;
  leaveDays: number;
  lateCount: number;
  presentDays: number;
}

/** Per-employee totals over whatever rows are passed in (already filtered to
 *  the desired date range and, for the Leaderboard, department) - the basis
 *  for both the org-wide averages on the dashboard's KPI cards and the
 *  leaderboard table. */
export function metricsForPeriod(rows: TeamAttendanceDayView[]): EmployeePeriodMetrics[] {
  const byEmployee = new Map<string, TeamAttendanceDayView[]>();
  for (const row of rows) {
    const existing = byEmployee.get(row.employee_id);
    if (existing) existing.push(row);
    else byEmployee.set(row.employee_id, [row]);
  }

  return Array.from(byEmployee.values()).map((employeeRows) => {
    const { employee_id: employeeId, employee_name: employeeName, department } = employeeRows[0];
    let totalMinutes = 0;
    let overtimeMinutes = 0;
    let leaveDays = 0;
    let lateCount = 0;
    let presentDays = 0;

    for (const row of employeeRows) {
      const s = statusFor(row);
      if (s.status === 'on_leave') leaveDays += 1;
      if (s.status === 'late') lateCount += 1;
      if (s.status === 'present' || s.status === 'late' || s.status === 'wfh') {
        presentDays += 1;
        totalMinutes += row.working_minutes ?? 0;
        overtimeMinutes += row.overtime_minutes ?? 0;
      }
    }

    return {
      employeeId,
      employeeName,
      department,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      overtimeHours: Math.round((overtimeMinutes / 60) * 10) / 10,
      leaveDays,
      lateCount,
      presentDays,
    };
  });
}

/** Org-wide per-employee-per-day average (work or overtime hours) over
 *  whatever rows are passed in - what the dashboard's summary KPI cards show.
 *  `employeeCount`/`dayCount` are passed explicitly rather than re-derived
 *  from `rows`, since an employee with zero rows for the period (shouldn't
 *  happen, but not asserted here) would otherwise silently vanish from the
 *  average's denominator. */
export function avgHoursForPeriod(
  rows: TeamAttendanceDayView[],
  kind: 'work' | 'overtime',
  employeeCount: number,
  dayCount: number,
): number {
  if (employeeCount === 0 || dayCount === 0) return 0;
  const sumMinutes = rows.reduce(
    (acc, r) => acc + (kind === 'work' ? (r.working_minutes ?? 0) : (r.overtime_minutes ?? 0)),
    0,
  );
  return Math.round((sumMinutes / 60 / employeeCount / dayCount) * 10) / 10;
}
