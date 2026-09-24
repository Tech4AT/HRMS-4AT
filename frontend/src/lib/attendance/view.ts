import type { AttendanceDayView } from '@/lib/api/attendance';

/** Shared row shape + mapping used by both the Attendance Log table
 *  (app/(app)/me/attendance) and the read-only Calendar view
 *  (components/attendance/MyAttendanceCalendar) - kept in one place so the
 *  two views never drift on how an `AttendanceDayView` is interpreted. */

export type DayStatus = 'present' | 'weekoff' | 'holiday' | 'on_leave' | 'absent' | 'not_marked' | 'inprogress';

export interface AttendanceRow {
  date: Date;
  status: DayStatus;
  checkIn?: string;
  checkOut?: string;
  effectiveMinutes?: number;
  arrival?: 'On Time' | 'Late';
  departure?: 'On Time' | 'Early';
  overtimeMinutes?: number;
  note?: string;
  noteDescription?: string | null;
  isWfhDay?: boolean;
  wfhNote?: string | null;
  wfhDescription?: string | null;
  events?: { name: string; description: string | null }[];
}

export function fmtHM(minutes?: number) {
  if (minutes == null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// Local (not UTC) YYYY-MM-DD — Date#toISOString() converts to UTC first, which
// shifts the date by a day for anyone west of UTC. Build the string from the
// local getFullYear/getMonth/getDate instead.
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ISO timestamp (UTC) → local "HH:MM" 24h string.
export function isoToHM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function toAttendanceRow(v: AttendanceDayView): AttendanceRow {
  const date = new Date(`${v.attendance_date}T00:00:00`);

  if (v.status === 'weekend') return { date, status: 'weekoff', events: v.events };
  if (v.status === 'holiday')
    return {
      date,
      status: 'holiday',
      note: v.holiday_name ?? 'Holiday',
      noteDescription: v.holiday_description,
      events: v.events,
    };
  if (v.status === 'on_leave') return { date, status: 'on_leave', note: v.leave_type_name ?? 'On Leave', events: v.events };
  if (v.status === 'absent') return { date, status: 'absent', events: v.events };
  if (v.status === 'not_marked')
    return {
      date,
      status: 'not_marked',
      isWfhDay: v.is_wfh_day,
      wfhNote: v.wfh_note,
      wfhDescription: v.wfh_description,
      events: v.events,
    };

  // present / work_from_home / half_day
  return {
    date,
    status: v.check_out ? 'present' : 'inprogress',
    checkIn: v.check_in ? isoToHM(v.check_in) : undefined,
    checkOut: v.check_out ? isoToHM(v.check_out) : undefined,
    effectiveMinutes: v.working_minutes ?? undefined,
    arrival: v.late_minutes && v.late_minutes > 0 ? 'Late' : 'On Time',
    departure: v.early_leave_minutes && v.early_leave_minutes > 0 ? 'Early' : 'On Time',
    isWfhDay: v.is_wfh_day,
    wfhNote: v.wfh_note,
    wfhDescription: v.wfh_description,
    events: v.events,
    overtimeMinutes: v.overtime_minutes ?? undefined,
  };
}
