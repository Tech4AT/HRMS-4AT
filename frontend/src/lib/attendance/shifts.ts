/** Sample (frontend-only) data for Settings > Shifts. There's no backend for
 *  shifts yet, so this just seeds a few realistic-looking shifts against the
 *  shared sample roster (see sample-employees.ts) to assign them to, for the
 *  UI to be reviewed end to end. */

import { SAMPLE_EMPLOYEES, type SampleEmployee } from './sample-employees';

export type ShiftEmployee = SampleEmployee;

export interface Shift {
  id: string;
  name: string;
  /** 24h "HH:MM". `endTime` earlier than `startTime` means an overnight shift. */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  employeeIds: string[];
}

export const SAMPLE_SHIFT_EMPLOYEES: ShiftEmployee[] = SAMPLE_EMPLOYEES;

export const SAMPLE_SHIFTS: Shift[] = [
  {
    id: 'shift-general',
    name: 'General Shift',
    startTime: '09:30',
    endTime: '18:30',
    breakMinutes: 60,
    employeeIds: ['emp-demo', 'emp-aditi', 'emp-rahul'],
  },
  {
    id: 'shift-morning',
    name: 'Morning Shift',
    startTime: '06:00',
    endTime: '14:00',
    breakMinutes: 30,
    employeeIds: ['emp-vikram'],
  },
  {
    id: 'shift-night',
    name: 'Night Shift',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 45,
    employeeIds: [],
  },
];

export function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Net working hours (gross span minus break), handling overnight shifts
 *  where `endTime` wraps past midnight. */
export function shiftWorkingMinutes(shift: Pick<Shift, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let span = eh * 60 + em - (sh * 60 + sm);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - shift.breakMinutes);
}

export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
