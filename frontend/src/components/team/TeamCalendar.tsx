'use client';

import { ChevronDownIcon, ChevronLeftIcon } from '@/components/icons';
import type { TeamAttendanceDayView } from '@/lib/api/teamAttendance';
import { fullName, type DirectoryPerson } from '@/lib/team/groups';
import { Avatar } from './MemberCard';

/** How one day is drawn in the calendar. Holiday and weekly off outrank leave,
 *  and leave outranks a clock-in, exactly as the attendance day view decides. */
function dayStyle(row: TeamAttendanceDayView | undefined): { cls: string; title: string } {
  if (!row) return { cls: 'text-gray-400', title: '' };
  // Soft tints, not solid fills: ordinary days stay plain so the exceptions stand out.
  if (row.is_holiday) return { cls: 'bg-emerald-100 text-emerald-700', title: row.holiday_name ?? 'Holiday' };
  if (row.is_weekend) return { cls: 'bg-slate-100 text-slate-400', title: 'Weekly off' };
  if (row.status === 'on_leave') return { cls: 'bg-sky-100 text-sky-700', title: row.leave_type_name ?? 'On leave' };
  if (row.status === 'work_from_home') return { cls: 'bg-violet-100 text-violet-700', title: 'Work from home' };
  if (row.status === 'absent') return { cls: 'bg-red-50 text-red-500', title: 'Absent' };
  return { cls: 'text-gray-500', title: '' };
}

const LEGEND: { label: string; cls: string }[] = [
  { label: 'Work from home', cls: 'bg-violet-100 border border-violet-300' },
  { label: 'On leave', cls: 'bg-sky-100 border border-sky-300' },
  { label: 'Absent', cls: 'bg-red-50 border border-red-300' },
  { label: 'Weekly off', cls: 'bg-slate-100 border border-slate-300' },
  { label: 'Holiday', cls: 'bg-emerald-100 border border-emerald-300' },
];

interface Props {
  month: Date;
  onShift: (delta: number) => void;
  /** Members the calendar has data for. */
  members: DirectoryPerson[];
  /** `undefined` while this month is still loading. */
  rows: TeamAttendanceDayView[] | undefined;
  today: string;
  /** "Based on 3 of 10 people" when the calendar covers only part of the group. */
  note?: string | null;
}

export function TeamCalendar({ month, onShift, members, rows, today, note }: Props) {
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1));
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const rowFor = new Map<string, TeamAttendanceDayView>();
  for (const r of rows ?? []) rowFor.set(`${r.employee_id}|${r.attendance_date}`, r);
  const visible = members.filter((m) => days.some((d) => rowFor.has(`${m.id}|${iso(d)}`)));

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 mb-3">
        <h2 className="text-base font-bold text-slate-900">Team calendar</h2>
        {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => onShift(-1)}
            aria-label="Previous month"
            className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-900 w-24 text-center">
            {month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
          <button
            onClick={() => onShift(1)}
            aria-label="Next month"
            className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700"
          >
            <ChevronDownIcon className="w-4 h-4 -rotate-90" />
          </button>
        </div>

        {rows === undefined ? (
          <p className="text-sm text-slate-500">Loading calendar…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500">No calendar data for this group in this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white text-left text-xs font-semibold text-gray-500 pr-4 pb-2 w-44">
                    Team member
                  </th>
                  {days.map((d) => (
                    <th key={iso(d)} className="text-[10px] font-semibold text-gray-400 pb-2 px-1 w-8">
                      {d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id}>
                    <td className="sticky left-0 bg-white pr-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <Avatar person={m} size="sm" />
                        <span className="text-sm text-slate-700 whitespace-nowrap">{fullName(m)}</span>
                      </div>
                    </td>
                    {days.map((d) => {
                      const key = iso(d);
                      const style = dayStyle(rowFor.get(`${m.id}|${key}`));
                      return (
                        <td key={key} className="px-1 py-1.5 text-center">
                          <span
                            title={style.title || undefined}
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${style.cls} ${
                              key === today ? 'ring-2 ring-indigo-400' : ''
                            }`}
                          >
                            {d.getDate()}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 pt-4 border-t border-gray-100">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-3 h-3 rounded-full ${l.cls}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
