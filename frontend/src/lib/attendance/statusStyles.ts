import type { DailyStatus } from './dashboard';

/** How a day's attendance status reads and looks wherever a manager sees it:
 *  the Dashboard's Today's Status table and a person's attendance detail. */
export const STATUS_LABEL: Record<DailyStatus, string> = {
  present: 'Present',
  late: 'Late',
  on_leave: 'On Leave',
  wfh: 'WFH',
  absent: 'Absent',
  day_off: 'Day Off',
  not_marked: 'Not Marked',
};

export const STATUS_BADGE: Record<DailyStatus, string> = {
  present: 'bg-emerald-100 text-emerald-700',
  late: 'bg-amber-100 text-amber-700',
  on_leave: 'bg-violet-100 text-violet-700',
  wfh: 'bg-blue-100 text-blue-700',
  absent: 'bg-red-100 text-red-700',
  day_off: 'bg-slate-100 text-slate-500',
  not_marked: 'bg-slate-100 text-slate-400',
};
