'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { attendanceApi } from '@/lib/api/attendance';
import { fmtHM, toAttendanceRow, toLocalISODate, type AttendanceRow, type DayStatus } from '@/lib/attendance/view';

const STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  inprogress: 'In Progress',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  absent: 'Absent',
  weekoff: 'Week Off',
  not_marked: 'Not Marked',
};

/** Read-only month calendar: your own attendance (green = attended, red =
 *  absent) plus org-wide holidays/WFH days/events. Clicking a day opens a
 *  sticky side panel (same layout as Settings > Calendar Management) showing
 *  that day's calendar info plus your attendance log for it, with the same
 *  regularise/WFH/leave actions as the Attendance Log table. Navigates its
 *  own month independently of any other date range. View only - editing the
 *  org calendar itself lives under Settings > Calendar Management
 *  (components/attendance/CalendarManagementPanel), HR-admin-only. */
export function MyAttendanceCalendar() {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const from = toLocalISODate(new Date(year, month, 1));
    const to = toLocalISODate(new Date(year, month + 1, 0));
    attendanceApi
      .getHistory({ from, to })
      .then((views) => {
        if (!cancelled) setRows(views.map(toAttendanceRow));
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load calendar');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const byDate = new Map(rows.map((r) => [toLocalISODate(r.date), r]));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const todayStr = toLocalISODate(new Date());

  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toLocalISODate(new Date(year, month, d)));

  const colorFor = (status?: DayStatus) => {
    switch (status) {
      case 'present':
        return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
      case 'inprogress':
        return 'bg-blue-100 text-blue-700 hover:bg-blue-200';
      case 'on_leave':
        return 'bg-violet-100 text-violet-700 hover:bg-violet-200';
      case 'holiday':
        return 'bg-amber-100 text-amber-700 hover:bg-amber-200';
      case 'absent':
        return 'bg-red-100 text-red-700 hover:bg-red-200';
      case 'weekoff':
        return 'bg-slate-100 text-slate-400 hover:bg-slate-200';
      default:
        return 'text-slate-400 hover:bg-slate-50';
    }
  };

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const goToMonth = (delta: number) => {
    setSelectedDate(null);
    setViewDate(new Date(year, month + delta, 1));
  };
  const goToToday = () => {
    setSelectedDate(null);
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const selectedRow = selectedDate ? byDate.get(selectedDate) : undefined;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">{monthLabel}</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToMonth(-1)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              onClick={goToToday}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Today
            </button>
            <button
              onClick={() => goToMonth(1)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] font-medium text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Attended
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Absent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-violet-500" /> Leave
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Holiday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> WFH
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" /> Event
          </span>
        </div>

        {loadError ? <p className="text-sm text-red-600 mb-3">{loadError}</p> : null}

        <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-slate-400 uppercase mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={i} />;
            const row = byDate.get(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = selectedDate === dateStr;

            const tooltipParts = [
              row?.note ? `${row.note}${row.noteDescription ? ` — ${row.noteDescription}` : ''}` : null,
              row?.isWfhDay ? `WFH: ${row.wfhNote ?? 'Org-wide WFH day'}${row.wfhDescription ? ` — ${row.wfhDescription}` : ''}` : null,
              ...(row?.events?.map((e) => `Event: ${e.name}${e.description ? ` — ${e.description}` : ''}`) ?? []),
            ].filter(Boolean);

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                disabled={loading}
                title={tooltipParts.join('\n') || undefined}
                className={`w-full aspect-square rounded-lg flex flex-col items-center justify-center text-sm font-medium transition-colors ${colorFor(
                  row?.status,
                )} ${isToday ? 'ring-2 ring-blue-500' : ''} ${isSelected ? 'ring-2 ring-indigo-500' : ''}`}
              >
                {Number(dateStr.slice(-2))}
                <span className="flex items-center gap-0.5 mt-0.5">
                  {row?.isWfhDay ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> : null}
                  {row?.events?.length ? <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 xl:sticky xl:top-4">
        {!selectedDate ? (
          <p className="text-sm text-slate-400">Select a day on the calendar to view its details.</p>
        ) : (
          <DayDetailPanel date={selectedDate} row={selectedRow} onClose={() => setSelectedDate(null)} />
        )}
      </div>
    </div>
  );
}

function fmtDayHeading(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Side panel shown when a day is selected in {@link MyAttendanceCalendar}:
 *  what's on that day (holiday/WFH/event details), your attendance log for
 *  it (check-in/out, hours, arrival/departure, overtime), followed by the
 *  same three actions as the Attendance Log table's row "⋮" menu. */
function DayDetailPanel({
  date,
  row,
  onClose,
}: {
  date: string;
  row?: AttendanceRow;
  onClose: () => void;
}) {
  const router = useRouter();

  const hasCalendarInfo = Boolean(row?.note || row?.isWfhDay || row?.events?.length);
  const hasAttendanceLog = Boolean(row?.checkIn || row?.checkOut || row?.status);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <p className="text-sm font-bold text-slate-900">{fmtDayHeading(date)}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm leading-none" aria-label="Close">
          ✕
        </button>
      </div>

      {hasCalendarInfo ? (
        <div className="space-y-2 pb-4 border-b border-slate-100">
          {row?.note ? (
            <div>
              <span className="inline-flex text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">
                {row.status === 'on_leave' ? 'Leave' : 'Holiday'}
              </span>
              <p className="text-xs text-slate-700 mt-1">{row.note}</p>
              {row.noteDescription ? <p className="text-[11px] text-slate-500">{row.noteDescription}</p> : null}
            </div>
          ) : null}
          {row?.isWfhDay ? (
            <div>
              <span className="inline-flex text-[10px] font-semibold rounded px-1.5 py-0.5 bg-blue-100 text-blue-700">
                WFH
              </span>
              <p className="text-xs text-slate-700 mt-1">{row.wfhNote ?? 'Org-wide WFH day'}</p>
              {row.wfhDescription ? <p className="text-[11px] text-slate-500">{row.wfhDescription}</p> : null}
            </div>
          ) : null}
          {row?.events?.map((e, i) => (
            <div key={i}>
              <span className="inline-flex text-[10px] font-semibold rounded px-1.5 py-0.5 bg-fuchsia-100 text-fuchsia-700">
                Event
              </span>
              <p className="text-xs text-slate-700 mt-1">{e.name}</p>
              {e.description ? <p className="text-[11px] text-slate-500">{e.description}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {hasAttendanceLog ? (
        <div className="pb-4 border-b border-slate-100">
          <p className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Attendance Log</p>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium text-slate-800">{row?.status ? STATUS_LABEL[row.status] : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Check-in</dt>
              <dd className="font-medium text-slate-800">{row?.checkIn ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Check-out</dt>
              <dd className="font-medium text-slate-800">{row?.checkOut ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Effective hours</dt>
              <dd className="font-medium text-slate-800">{fmtHM(row?.effectiveMinutes)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Arrival</dt>
              <dd className="font-medium text-slate-800">{row?.arrival ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Departure</dt>
              <dd className="font-medium text-slate-800">{row?.departure ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Overtime</dt>
              <dd className="font-medium text-slate-800">{fmtHM(row?.overtimeMinutes)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="space-y-1">
        <button
          onClick={() => router.push(`/attendance/regularize?date=${date}`)}
          className="block w-full text-left px-2 py-2 text-sm rounded-lg text-slate-700 hover:bg-slate-50"
        >
          Regularise
        </button>
        <button
          onClick={() => router.push(`/attendance/wfh?date=${date}`)}
          className="block w-full text-left px-2 py-2 text-sm rounded-lg text-slate-700 hover:bg-slate-50"
        >
          Request Work From Home
        </button>
        <button
          onClick={() => router.push(`/leave/apply?date=${date}`)}
          className="block w-full text-left px-2 py-2 text-sm rounded-lg text-slate-700 hover:bg-slate-50"
        >
          Request Leave
        </button>
      </div>
    </div>
  );
}
