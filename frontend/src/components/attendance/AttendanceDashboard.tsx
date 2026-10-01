'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';
import { leaveApi } from '@/lib/api/leave';
import { attendanceApi } from '@/lib/api/attendance';
import { penalisationApi } from '@/lib/api/penalisation';
import { teamAttendanceApi, type TeamAttendanceDayView } from '@/lib/api/teamAttendance';
import { AttendanceLeaderboard } from '@/components/attendance/AttendanceLeaderboard';
import { MemberAttendanceDetail } from '@/components/attendance/MemberAttendanceDetail';
import { STATUS_BADGE, STATUS_LABEL } from '@/lib/attendance/statusStyles';
import { fmtHM, isoToHM } from '@/lib/attendance/view';
import {
  aggregateForDay,
  avgHoursForPeriod,
  lastNDays,
  statusFor,
  toLocalISODate,
  type DailyStatus,
  type DayAttendanceAggregate,
} from '@/lib/attendance/dashboard';

const STATUS_BAR: Record<DailyStatus, string> = {
  present: 'bg-emerald-500',
  late: 'bg-amber-500',
  on_leave: 'bg-violet-500',
  wfh: 'bg-blue-500',
  absent: 'bg-red-500',
  day_off: 'bg-slate-300',
  not_marked: 'bg-slate-200',
};

// day_off/not_marked deliberately excluded from the donut/weekly-trend bars -
// they're not part of "how did the workforce show up" the way the other five
// are (nobody was expected to work, or the day genuinely isn't over yet).
const STATUS_ORDER: DailyStatus[] = ['present', 'late', 'wfh', 'on_leave', 'absent'];

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-slate-900'}`}>{value}</p>
      {sub ? <p className="text-xs text-slate-400 mt-1">{sub}</p> : null}
    </div>
  );
}

/** Today's status counts as a donut, replacing what used to be four separate
 * "Present/Late/On Leave/WFH" KPI cards plus a redundant "On Leave" list -
 * one glance shows the whole breakdown instead of five repeated numbers. */
function TodayDonut({ agg }: { agg: DayAttendanceAggregate }) {
  const counts: Record<DailyStatus, number> = {
    present: agg.present,
    late: agg.late,
    wfh: agg.wfh,
    on_leave: agg.onLeave,
    absent: agg.absent,
    day_off: agg.dayOff,
    not_marked: agg.notMarked,
  };
  // The donut itself only shows the five "did they show up" buckets - a
  // headcount that's entirely on a day off would otherwise render an empty
  // ring, which reads as "no data" rather than "everyone's off today".
  const shownTotal = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0) || 1;
  const size = 120;
  const thickness = 16;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
          {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => {
            const dash = (counts[s] / shownTotal) * circumference;
            const el = (
              <circle
                key={s}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={
                  { present: '#10B981', late: '#F59E0B', wfh: '#3B82F6', on_leave: '#8B5CF6', absent: '#EF4444' }[
                    s as 'present' | 'late' | 'wfh' | 'on_leave' | 'absent'
                  ]
                }
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-slate-900">{agg.total}</span>
          <span className="text-[10px] text-slate-400">people</span>
        </div>
      </div>
      <div className="space-y-1.5 flex-1">
        {(agg.dayOff || agg.notMarked ? [...STATUS_ORDER, 'day_off' as const, 'not_marked' as const] : STATUS_ORDER)
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <div key={s} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className={`w-2 h-2 rounded-full ${STATUS_BAR[s]}`} />
                {STATUS_LABEL[s]}
              </span>
              <span className="font-semibold text-slate-800">{counts[s]}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

/** Attendance & Leave > Dashboard. Attendance/leave analytics for a
 *  manager's reportees or, for an org-scoped HR admin, the whole
 *  organisation - real, scoped data as of PLAN.md Step 9
 *  (`teamAttendanceApi`, `/attendance/team/daily`), replacing the old fully
 *  synthetic sample roster. Pending Approvals and Active Penalisations were
 *  already real signals, pulled in separately here, same as before. */
export function AttendanceDashboard() {
  const { hasPermission, hasOrgScope } = useAuth();
  const canApproveLeave = hasPermission('leave.approve');
  const canApproveAttendance = hasPermission('attendance.approve');
  const canManagePenalisations = hasPermission('penalisation.manage');
  const orgWide = hasOrgScope();

  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [activePenalisations, setActivePenalisations] = useState<number>(0);
  const [teamRows, setTeamRows] = useState<TeamAttendanceDayView[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => toLocalISODate(new Date()));
  const [detailFor, setDetailFor] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    const tasks: Promise<number>[] = [];
    if (canApproveLeave) tasks.push(leaveApi.getPendingApprovals().then((r) => r.length));
    if (canApproveAttendance) tasks.push(attendanceApi.getPendingApprovals().then((r) => r.length));
    if (tasks.length === 0) {
      setPendingApprovals(0);
      return;
    }
    Promise.all(tasks)
      .then((counts) => {
        if (active) setPendingApprovals(counts.reduce((a, b) => a + b, 0));
      })
      .catch(() => {
        if (active) setPendingApprovals(null);
      });
    return () => {
      active = false;
    };
  }, [canApproveLeave, canApproveAttendance]);

  // Penalisation has no manager/team scope (PLAN.md Step 8 - it's a flat,
  // HR-only concern, `penalisation.manage`), unlike Pending Approvals above -
  // a manager viewing this dashboard simply sees 0 here, not a 403.
  useEffect(() => {
    let active = true;
    if (!canManagePenalisations) {
      setActivePenalisations(0);
      return;
    }
    penalisationApi
      .getAll('applied')
      .then((rows) => {
        if (active) setActivePenalisations(rows.length);
      })
      .catch(() => {
        if (active) setActivePenalisations(0);
      });
    return () => {
      active = false;
    };
  }, [canManagePenalisations]);

  const today = toLocalISODate(new Date());
  const week = useMemo(() => lastNDays(7), []);

  useEffect(() => {
    let active = true;
    setTeamLoading(true);
    setTeamError(null);
    teamAttendanceApi
      .getDaily(week[0], today)
      .then((rows) => {
        if (active) setTeamRows(rows);
      })
      .catch((e) => {
        if (active) setTeamError(e instanceof Error ? e.message : 'Failed to load team attendance');
      })
      .finally(() => {
        if (active) setTeamLoading(false);
      });
    return () => {
      active = false;
    };
  }, [week, today]);

  const todayAgg = useMemo(() => aggregateForDay(teamRows, today), [teamRows, today]);
  const weekAgg = useMemo(() => week.map((d) => aggregateForDay(teamRows, d)), [teamRows, week]);
  const employeeCount = useMemo(() => new Set(teamRows.map((r) => r.employee_id)).size, [teamRows]);
  const avgWork = useMemo(
    () => avgHoursForPeriod(teamRows, 'work', employeeCount, week.length),
    [teamRows, employeeCount, week.length],
  );
  const avgOvertime = useMemo(
    () => avgHoursForPeriod(teamRows, 'overtime', employeeCount, week.length),
    [teamRows, employeeCount, week.length],
  );
  // The day shown in the status table (today unless a manager picks an earlier
  // day from the week already loaded), with the full row so times and breaks show.
  const dayRows = useMemo(
    () =>
      teamRows
        .filter((r) => r.attendance_date === selectedDay)
        .sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
    [teamRows, selectedDay],
  );
  const attendanceRate = todayAgg.total
    ? Math.round(((todayAgg.present + todayAgg.late) / todayAgg.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{orgWide ? 'Organisation Overview' : 'Team Overview'}</h2>
          <p className="text-sm text-slate-500">
            {orgWide
              ? 'Attendance and leave snapshot across the organisation.'
              : 'Attendance and leave snapshot for your reportees.'}
          </p>
        </div>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700">
          {employeeCount} {orgWide ? 'employees' : 'reportees'}
        </span>
      </div>

      {teamError ? (
        <p className="text-sm text-red-600">{teamError}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              label="Attendance Today"
              value={teamLoading ? '…' : `${attendanceRate}%`}
              sub={`${todayAgg.present + todayAgg.late}/${todayAgg.total} in office or remote`}
              accent="text-emerald-600"
            />
            <KpiCard
              label="Pending Approvals"
              value={pendingApprovals === null ? '—' : String(pendingApprovals)}
              sub="WFH, regularisation & leave"
            />
            <KpiCard
              label="Active Penalisations"
              value={String(activePenalisations)}
              sub="Not yet overturned"
              accent={activePenalisations ? 'text-red-600' : undefined}
            />
            <KpiCard
              label="Avg. Hours (This Week)"
              value={teamLoading ? '…' : `${avgWork}h`}
              sub={`+${avgOvertime}h avg. overtime/day`}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-5 items-start">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Attendance This Week</h3>
              <div className="flex items-end gap-3 h-40">
                {weekAgg.map((d) => {
                  const label = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
                  const counts: Record<DailyStatus, number> = {
                    present: d.present,
                    late: d.late,
                    wfh: d.wfh,
                    on_leave: d.onLeave,
                    absent: d.absent,
                    day_off: d.dayOff,
                    not_marked: d.notMarked,
                  };
                  const barTotal = d.total || 1;
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-2 h-full">
                      <div className="w-full flex-1 flex flex-col-reverse rounded-t-md overflow-hidden">
                        {[...STATUS_ORDER, 'day_off' as const].map((s) =>
                          counts[s] > 0 ? (
                            <div
                              key={s}
                              className={STATUS_BAR[s]}
                              style={{ height: `${(counts[s] / barTotal) * 100}%` }}
                              title={`${STATUS_LABEL[s]}: ${counts[s]}`}
                            />
                          ) : null,
                        )}
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">{label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-slate-100 text-[11px] font-medium text-slate-500">
                {STATUS_ORDER.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_BAR[s]}`} /> {STATUS_LABEL[s]}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Today&apos;s Breakdown</h3>
              {teamLoading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (
                <TodayDonut agg={todayAgg} />
              )}
            </div>
          </div>

          <AttendanceLeaderboard />

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {selectedDay === today ? 'Today’s Status' : 'Status'}
                </h3>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  aria-label="Day"
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-700 bg-white"
                >
                  {[...week].reverse().map((d) => (
                    <option key={d} value={d}>
                      {d === today
                        ? 'Today'
                        : new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </option>
                  ))}
                </select>
              </div>
              <Link href="/approvals" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                Review approvals →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    {['Employee', 'Department', 'Status', 'Check-in', 'Check-out', 'Hours', 'Late', 'Breaks'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamLoading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">
                        Loading…
                      </td>
                    </tr>
                  ) : (
                    dayRows.map((row) => {
                      const s = statusFor(row);
                      return (
                        <tr key={s.employeeId} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">
                            <button
                              onClick={() => setDetailFor({ id: s.employeeId, name: s.employeeName })}
                              className="hover:text-indigo-700 hover:underline text-left"
                            >
                              {s.employeeName}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">{s.department ?? '—'}</td>
                          <td className="px-5 py-3 text-sm whitespace-nowrap">
                            <span className={`inline-flex text-[11px] font-semibold rounded-full px-2.5 py-1 ${STATUS_BADGE[s.status]}`}>
                              {STATUS_LABEL[s.status]}
                              {s.status === 'on_leave' && s.leaveType ? ` · ${s.leaveType}` : ''}
                            </span>
                            {row.on_break ? (
                              <span className="ml-1.5 inline-flex text-[10px] font-semibold rounded px-1.5 py-0.5 bg-violet-100 text-violet-700">
                                On break
                              </span>
                            ) : null}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                            {row.check_in ? isoToHM(row.check_in) : '—'}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                            {row.check_out ? isoToHM(row.check_out) : '—'}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                            {row.working_minutes != null ? fmtHM(row.working_minutes) : '—'}
                          </td>
                          <td className="px-5 py-3 text-sm whitespace-nowrap">
                            {(row.late_minutes ?? 0) > 0 ? (
                              <span className="text-amber-700">{row.late_minutes}m</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                            {(row.breaks ?? []).length > 0
                              ? `${row.breaks?.length} · ${fmtHM(row.break_minutes ?? 0)}`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {detailFor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20 bg-black/30 overflow-y-auto" onClick={() => setDetailFor(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Attendance for ${detailFor.name}`}
            className="bg-white rounded-lg shadow-xl w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 bg-slate-100 border-b border-slate-200 rounded-t-lg">
              <h2 className="text-base font-semibold text-slate-900 truncate">{detailFor.name} · Attendance</h2>
              <button onClick={() => setDetailFor(null)} aria-label="Close" className="text-slate-500 hover:text-slate-900 text-2xl leading-none px-1">
                &times;
              </button>
            </div>
            <div className="p-5">
              <MemberAttendanceDetail employeeId={detailFor.id} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
