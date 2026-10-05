import type { TeamAttendanceDayView } from '@/lib/api/teamAttendance';

/** One CSV field: quoted when it contains a comma, quote or newline, and
 *  neutralised when it starts with a character spreadsheets treat as a formula. */
function csvField(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

const hours = (minutes: number | null | undefined) =>
  minutes == null ? '' : (minutes / 60).toFixed(2);

const COLUMNS: { header: string; value: (r: TeamAttendanceDayView) => string | number | null }[] = [
  { header: 'Employee', value: (r) => r.employee_name },
  { header: 'Department', value: (r) => r.department },
  { header: 'Date', value: (r) => r.attendance_date },
  { header: 'Status', value: (r) => r.status },
  { header: 'Check in', value: (r) => hhmm(r.check_in) },
  { header: 'Check out', value: (r) => hhmm(r.check_out) },
  { header: 'Hours worked', value: (r) => hours(r.working_minutes) },
  { header: 'Break (min)', value: (r) => r.break_minutes ?? '' },
  { header: 'Late (min)', value: (r) => r.late_minutes ?? '' },
  { header: 'Early leave (min)', value: (r) => r.early_leave_minutes ?? '' },
  { header: 'Overtime hours', value: (r) => hours(r.overtime_minutes) },
  { header: 'Weekly off', value: (r) => (r.is_weekend ? 'Yes' : 'No') },
  { header: 'Holiday', value: (r) => (r.is_holiday ? (r.holiday_name ?? 'Yes') : '') },
  { header: 'On leave', value: (r) => (r.on_leave ? (r.leave_type_name ?? 'Yes') : '') },
  { header: 'WFH day', value: (r) => (r.is_wfh_day ? (r.wfh_note ?? 'Yes') : '') },
  { header: 'Source', value: (r) => r.source },
  { header: 'Notes', value: (r) => r.notes },
];

/** The rows as CSV text, sorted by employee then date. */
export function attendanceCsv(rows: TeamAttendanceDayView[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      a.employee_name.localeCompare(b.employee_name) || a.attendance_date.localeCompare(b.attendance_date),
  );
  const lines = [COLUMNS.map((c) => csvField(c.header)).join(',')];
  for (const row of sorted) lines.push(COLUMNS.map((c) => csvField(c.value(row))).join(','));
  return lines.join('\r\n');
}

/** Triggers a browser download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel read the file as UTF-8 (names with accents).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
