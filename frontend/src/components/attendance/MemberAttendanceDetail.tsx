'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { teamAttendanceApi, type TeamAttendanceDayView } from '@/lib/api/teamAttendance';
import { statusFor } from '@/lib/attendance/dashboard';
import { STATUS_BADGE, STATUS_LABEL } from '@/lib/attendance/statusStyles';
import { fmtHM, isoToHM, toLocalISODate } from '@/lib/attendance/view';

const RANGES = [
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
] as const;

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Chip({ tone, children }: { tone: 'amber' | 'sky' | 'violet'; children: React.ReactNode }) {
  const cls = {
    amber: 'bg-amber-100 text-amber-700',
    sky: 'bg-sky-100 text-sky-700',
    violet: 'bg-violet-100 text-violet-700',
  }[tone];
  return <span className={`inline-flex text-[10px] font-semibold rounded px-1.5 py-0.5 ${cls}`}>{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-slate-900 mt-0.5">{value}</p>
    </div>
  );
}

/** One person's recent days: when they checked in and out, hours worked, whether
 *  they were late, left early or did overtime, and every break. Only ever shown
 *  for people the viewer may read in full; the backend refuses anyone else. */
export function MemberAttendanceDetail({ employeeId }: { employeeId: string }) {
  const [days, setDays] = useState<number>(14);
  const [rows, setRows] = useState<TeamAttendanceDayView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDaysOff, setShowDaysOff] = useState(false);
  const [openBreaks, setOpenBreaks] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    teamAttendanceApi
      .getMember(employeeId, toLocalISODate(from), toLocalISODate(to))
      .then((d) => !cancelled && setRows(d.rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load attendance'));
    return () => {
      cancelled = true;
    };
  }, [employeeId, days]);

  const ordered = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.attendance_date.localeCompare(a.attendance_date)),
    [rows],
  );
  const visible = ordered.filter((r) => showDaysOff || !(r.is_holiday || r.is_weekend));

  const summary = useMemo(() => {
    const worked = ordered.filter((r) => ['present', 'late', 'wfh'].includes(statusFor(r).status));
    const minutes = worked.map((r) => r.working_minutes).filter((m): m is number => m != null);
    return {
      days: worked.length,
      late: worked.filter((r) => (r.late_minutes ?? 0) > 0).length,
      avg: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    };
  }, [ordered]);

  const toggleBreaks = (date: string) =>
    setOpenBreaks((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white" role="group" aria-label="Range">
          {RANGES.map((r, i) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`px-3 py-1.5 text-xs font-medium ${i > 0 ? 'border-l border-slate-200' : ''} ${
                days === r.days ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showDaysOff} onChange={(e) => setShowDaysOff(e.target.checked)} className="rounded border-slate-300" />
          Show weekly offs and holidays
        </label>
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {!rows && !error ? <p className="text-sm text-slate-500">Loading attendance…</p> : null}

      {rows ? (
        <>
          <div className="grid grid-cols-3 gap-4 bg-slate-50 rounded-lg px-4 py-3">
            <Stat label="Days worked" value={String(summary.days)} />
            <Stat label="Late arrivals" value={String(summary.late)} />
            <Stat label="Avg hours / day" value={summary.avg == null ? '—' : fmtHM(summary.avg)} />
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-slate-500">No working days in this range.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Date', 'Status', 'In', 'Out', 'Hours', 'Breaks'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => {
                    const s = statusFor(r);
                    const breaks = r.breaks ?? [];
                    const open = openBreaks.has(r.attendance_date);
                    return (
                      <Fragment key={r.attendance_date}>
                        <tr className="align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-800">{dayLabel(r.attendance_date)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_BADGE[s.status]}`}>
                              {STATUS_LABEL[s.status]}
                              {s.status === 'on_leave' && s.leaveType ? ` · ${s.leaveType}` : ''}
                            </span>
                            {r.on_break ? <span className="ml-1.5"><Chip tone="violet">On break</Chip></span> : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">{r.check_in ? isoToHM(r.check_in) : '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                            {r.check_out ? isoToHM(r.check_out) : r.check_in ? <span className="text-slate-400">Not yet</span> : '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="text-slate-800">{r.working_minutes != null ? fmtHM(r.working_minutes) : '—'}</span>
                            {r.shift_scheduled_minutes ? (
                              <span className="text-[11px] text-slate-400"> / {fmtHM(r.shift_scheduled_minutes)}</span>
                            ) : null}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(r.late_minutes ?? 0) > 0 ? <Chip tone="amber">Late {r.late_minutes}m</Chip> : null}
                              {(r.early_leave_minutes ?? 0) > 0 ? <Chip tone="amber">Left early {r.early_leave_minutes}m</Chip> : null}
                              {(r.overtime_minutes ?? 0) > 0 ? <Chip tone="sky">OT {fmtHM(r.overtime_minutes ?? 0)}</Chip> : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {breaks.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <button
                                onClick={() => toggleBreaks(r.attendance_date)}
                                aria-expanded={open}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                              >
                                {breaks.length} · {fmtHM(r.break_minutes ?? 0)} {open ? '▴' : '▾'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-slate-50">
                            <td colSpan={6} className="px-3 py-2">
                              <ul className="space-y-1 text-xs text-slate-700">
                                {breaks.map((b, i) => (
                                  <li key={i} className="flex gap-4">
                                    <span className="w-28">
                                      {isoToHM(b.start)} – {b.end ? isoToHM(b.end) : 'now'}
                                    </span>
                                    <span className="text-slate-500">{fmtHM(b.minutes)}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
