/** Sample (frontend-only) data behind the Attendance & Leave Dashboard tab.
 *  There's no backend yet for team/org-wide attendance analytics (the real
 *  attendance API only covers the logged-in employee's own history - see
 *  lib/api/attendance.ts), so this derives a stable, realistic-looking
 *  snapshot from the shared sample roster (sample-employees.ts) instead. Real
 *  signals we do have - pending approvals, active penalisations - are pulled
 *  in separately by the dashboard component itself via `leaveApi`/
 *  `attendanceApi`/`usePenalisations`, not from here. */

import { SAMPLE_EMPLOYEES, type SampleEmployee } from './sample-employees';

export type DailyStatus = 'present' | 'late' | 'on_leave' | 'wfh' | 'absent';

export interface EmployeeDayStatus {
  employee: SampleEmployee;
  status: DailyStatus;
  checkIn?: string;
  leaveType?: string;
}

const LEAVE_TYPES_FOR_SAMPLE = ['Sick Leave', 'Annual Leave', 'Casual Leave'];

function seeded(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Deterministic per-employee, per-day status - stable across renders and
 *  reloads (no randomness that would make the dashboard flicker), but varies
 *  day to day so a weekly trend looks like real attendance data. */
export function statusFor(employee: SampleEmployee, dateStr: string): EmployeeDayStatus {
  const roll = seeded(`${employee.id}-${dateStr}`, 100);
  if (roll < 6) return { employee, status: 'on_leave', leaveType: LEAVE_TYPES_FOR_SAMPLE[seeded(`${employee.id}-${dateStr}-lt`, LEAVE_TYPES_FOR_SAMPLE.length)] };
  if (roll < 10) return { employee, status: 'absent' };
  if (roll < 18) return { employee, status: 'wfh' };
  if (roll < 30) {
    const totalMinutes = 9 * 60 + 30 + 10 + seeded(`${employee.id}-${dateStr}-late`, 45);
    return { employee, status: 'late', checkIn: `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}` };
  }
  const onTimeMinutes = 9 * 60 + seeded(`${employee.id}-${dateStr}-in`, 25);
  return { employee, status: 'present', checkIn: `${Math.floor(onTimeMinutes / 60)}:${String(onTimeMinutes % 60).padStart(2, '0')}` };
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
  total: number;
}

export function aggregateForDay(dateStr: string, roster: SampleEmployee[] = SAMPLE_EMPLOYEES): DayAttendanceAggregate {
  const rows = roster.map((e) => statusFor(e, dateStr));
  return {
    date: dateStr,
    present: rows.filter((r) => r.status === 'present').length,
    late: rows.filter((r) => r.status === 'late').length,
    onLeave: rows.filter((r) => r.status === 'on_leave').length,
    wfh: rows.filter((r) => r.status === 'wfh').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    total: roster.length,
  };
}

/** A day's hours worked/overtime for one employee - 0/0 if they weren't
 *  working that day (leave or absence). Deterministic, same caveats as
 *  {@link statusFor}. */
export function dayHours(employeeId: string, dateStr: string, status: DailyStatus): { work: number; overtime: number } {
  if (status === 'on_leave' || status === 'absent') return { work: 0, overtime: 0 };
  const base = status === 'wfh' ? 7.5 : status === 'late' ? 7.6 : 8;
  const variance = seeded(`${employeeId}-${dateStr}-wh`, 21) / 10;
  const work = Math.round((base - 1 + variance) * 10) / 10;
  const otRoll = seeded(`${employeeId}-${dateStr}-ot`, 100);
  const overtime = otRoll < 35 ? Math.round((1 + seeded(`${employeeId}-${dateStr}-otv`, 20) / 10) * 10) / 10 : 0;
  return { work, overtime };
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
  employee: SampleEmployee;
  totalHours: number;
  overtimeHours: number;
  leaveDays: number;
  lateCount: number;
  presentDays: number;
}

/** Per-employee totals over an arbitrary set of days - the basis for both
 *  the org-wide averages on the dashboard's KPI cards and the leaderboard
 *  table (most hours worked, most overtime, most leave taken, ...). */
export function metricsForPeriod(days: string[], roster: SampleEmployee[] = SAMPLE_EMPLOYEES): EmployeePeriodMetrics[] {
  return roster.map((employee) => {
    let totalHours = 0;
    let overtimeHours = 0;
    let leaveDays = 0;
    let lateCount = 0;
    let presentDays = 0;
    for (const d of days) {
      const s = statusFor(employee, d);
      if (s.status === 'on_leave') leaveDays += 1;
      if (s.status === 'late') lateCount += 1;
      if (s.status === 'present' || s.status === 'late' || s.status === 'wfh') {
        presentDays += 1;
        const { work, overtime } = dayHours(employee.id, d, s.status);
        totalHours += work;
        overtimeHours += overtime;
      }
    }
    return {
      employee,
      totalHours: Math.round(totalHours * 10) / 10,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
      leaveDays,
      lateCount,
      presentDays,
    };
  });
}

/** Org-wide per-day average (work or overtime hours) over a set of days -
 *  what the dashboard's summary KPI cards show. */
export function avgHoursForPeriod(days: string[], kind: 'work' | 'overtime', roster: SampleEmployee[] = SAMPLE_EMPLOYEES): number {
  if (days.length === 0 || roster.length === 0) return 0;
  const metrics = metricsForPeriod(days, roster);
  const sum = metrics.reduce((acc, m) => acc + (kind === 'work' ? m.totalHours : m.overtimeHours), 0);
  return Math.round((sum / roster.length / days.length) * 10) / 10;
}
