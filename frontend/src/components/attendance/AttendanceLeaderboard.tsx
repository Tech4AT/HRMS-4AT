'use client';

import { useEffect, useMemo, useState } from 'react';
import { teamAttendanceApi, type TeamAttendanceDayView } from '@/lib/api/teamAttendance';
import { PERIOD_LABEL, metricsForPeriod, periodDays, type EmployeePeriodMetrics, type Period } from '@/lib/attendance/dashboard';

type MetricId = 'hours' | 'overtime' | 'leave' | 'late';

const METRICS: Record<MetricId, { label: string; unit: string; value: (m: EmployeePeriodMetrics) => number }> = {
  hours: { label: 'Most Hours Worked', unit: 'h', value: (m) => m.totalHours },
  overtime: { label: 'Most Overtime Hours', unit: 'h', value: (m) => m.overtimeHours },
  leave: { label: 'Most Leave Taken', unit: 'day(s)', value: (m) => m.leaveDays },
  late: { label: 'Most Late Arrivals', unit: '', value: (m) => m.lateCount },
};

const ALL_DEPARTMENTS = 'All Departments';

/** The dashboard's configurable leaderboard - ranks the team/org by whichever
 *  metric and time period is selected. Real, scoped data as of PLAN.md Step 9
 *  (`teamAttendanceApi`) - fetches its own range independently of the rest of
 *  the Dashboard, since the selected period can span up to a full month,
 *  wider than the Dashboard's own fixed "last 7 days" fetch. */
export function AttendanceLeaderboard() {
  const [metric, setMetric] = useState<MetricId>('hours');
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [rows, setRows] = useState<TeamAttendanceDayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const days = useMemo(() => periodDays(period), [period]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    teamAttendanceApi
      .getDaily(days[0], days[days.length - 1])
      .then((loaded) => {
        if (active) setRows(loaded);
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load the leaderboard');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days]);

  const departments = useMemo(
    () => [ALL_DEPARTMENTS, ...Array.from(new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d))))],
    [rows],
  );

  const ranked = useMemo(() => {
    const filtered = department === ALL_DEPARTMENTS ? rows : rows.filter((r) => r.department === department);
    const metrics = metricsForPeriod(filtered);
    return [...metrics].sort((a, b) => METRICS[metric].value(b) - METRICS[metric].value(a));
  }, [rows, department, metric]);

  const config = METRICS[metric];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Leaderboard</h3>
          <p className="text-xs text-slate-500 mt-1">Rank the team by a metric over a chosen period.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricId)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          >
            {(Object.keys(METRICS) as MetricId[]).map((id) => (
              <option key={id} value={id}>
                {METRICS[id].label}
              </option>
            ))}
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          >
            {(Object.keys(PERIOD_LABEL) as Period[]).map((id) => (
              <option key={id} value={id}>
                {PERIOD_LABEL[id]}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          >
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-y border-slate-200">
            <tr>
              {['#', 'Employee', 'Department', config.label, 'Present Days'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-red-600">
                  {loadError}
                </td>
              </tr>
            ) : ranked.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                  No employees match this filter.
                </td>
              </tr>
            ) : (
              ranked.map((m, i) => (
                <tr key={m.employeeId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-sm font-semibold text-slate-400 whitespace-nowrap">{i + 1}</td>
                  <td className="px-5 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">{m.employeeName}</td>
                  <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">{m.department ?? '—'}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-indigo-700 whitespace-nowrap">
                    {config.value(m)}
                    {config.unit ? ` ${config.unit}` : ''}
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{m.presentDays}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
