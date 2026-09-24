'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';
import { leaveApi } from '@/lib/api/leave';
import { attendanceApi } from '@/lib/api/attendance';
import { usePenalisations } from '@/lib/attendance/penalisation';
import { SAMPLE_EMPLOYEES } from '@/lib/attendance/sample-employees';
import { AttendanceLeaderboard } from '@/components/attendance/AttendanceLeaderboard';
import {
  aggregateForDay,
  avgHoursForPeriod,
  lastNDays,
  statusFor,
  toLocalISODate,
  type DailyStatus,
  type DayAttendanceAggregate,
} from '@/lib/attendance/dashboard';

const STATUS_LABEL: Record<DailyStatus, string> = {
  present: 'Present',
  late: 'Late',
  on_leave: 'On Leave',
  wfh: 'WFH',
  absent: 'Absent',
};

const STATUS_BADGE: Record<DailyStatus, string> = {
  present: 'bg-emerald-100 text-emerald-700',
  late: 'bg-amber-100 text-amber-700',
  on_leave: 'bg-violet-100 text-violet-700',
  wfh: 'bg-blue-100 text-blue-700',
  absent: 'bg-red-100 text-red-700',
};

const STATUS_BAR: Record<DailyStatus, string> = {
  present: 'bg-emerald-500',
  late: 'bg-amber-500',
  on_leave: 'bg-violet-500',
  wfh: 'bg-blue-500',
  absent: 'bg-red-500',
};

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
  };
  const total = agg.total || 1;
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
            const dash = (counts[s] / total) * circumference;
            const el = (
              <circle
                key={s}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={
                  { present: '#10B981', late: '#F59E0B', wfh: '#3B82F6', on_leave: '#8B5CF6', absent: '#EF4444' }[s]
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
        {STATUS_ORDER.map((s) => (
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
 *  organisation. There's no real team/org-wide attendance API yet (the
 *  actual backend only covers the logged-in employee's own history), so most
 *  of this is derived from the shared sample roster (sample-employees.ts) via
 *  lib/attendance/dashboard.ts - deterministic, so it doesn't flicker between
 *  renders, but not real data. Pending Approvals and Active Penalisations are
 *  real signals, pulled in directly here. */
export function AttendanceDashboard() {
  const { hasPermission, hasOrgScope } = useAuth();
  const canApproveLeave = hasPermission('leave.approve');
  const canApproveAttendance = hasPermission('attendance.approve');
  const orgWide = hasOrgScope();

  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [penalisations] = usePenalisations();

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

  const today = toLocalISODate(new Date());
  const week = useMemo(() => lastNDays(7), []);
  const todayAgg = useMemo(() => aggregateForDay(today), [today]);
  const weekAgg = useMemo(() => week.map((d) => aggregateForDay(d)), [week]);
  const avgWork = useMemo(() => avgHoursForPeriod(week, 'work'), [week]);
  const avgOvertime = useMemo(() => avgHoursForPeriod(week, 'overtime'), [week]);
  const activePenalisations = penalisations.filter((p) => p.status === 'applied').length;
  const todayStatuses = useMemo(() => SAMPLE_EMPLOYEES.map((e) => statusFor(e, today)), [today]);
  const attendanceRate = todayAgg.total ? Math.round(((todayAgg.present + todayAgg.late) / todayAgg.total) * 100) : 0;

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
          {SAMPLE_EMPLOYEES.length} {orgWide ? 'employees' : 'reportees'}
        </span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Attendance Today"
          value={`${attendanceRate}%`}
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
        <KpiCard label="Avg. Hours (This Week)" value={`${avgWork}h`} sub={`+${avgOvertime}h avg. overtime/day`} />
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
              };
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2 h-full">
                  <div className="w-full flex-1 flex flex-col-reverse rounded-t-md overflow-hidden">
                    {STATUS_ORDER.map((s) =>
                      counts[s] > 0 ? (
                        <div
                          key={s}
                          className={STATUS_BAR[s]}
                          style={{ height: `${(counts[s] / d.total) * 100}%` }}
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
          <TodayDonut agg={todayAgg} />
        </div>
      </div>

      <AttendanceLeaderboard />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Today&apos;s Status</h3>
          <Link href="/approvals" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            Review approvals →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-y border-slate-200">
              <tr>
                {['Employee', 'Department', 'Status', 'Check-in'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {todayStatuses.map((s) => (
                <tr key={s.employee.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">{s.employee.name}</td>
                  <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">{s.employee.department}</td>
                  <td className="px-5 py-3 text-sm whitespace-nowrap">
                    <span className={`inline-flex text-[11px] font-semibold rounded-full px-2.5 py-1 ${STATUS_BADGE[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                      {s.status === 'on_leave' && s.leaveType ? ` · ${s.leaveType}` : ''}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{s.checkIn ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
