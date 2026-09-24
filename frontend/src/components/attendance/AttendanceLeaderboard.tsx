'use client';

import { useMemo, useState } from 'react';
import { SAMPLE_EMPLOYEES } from '@/lib/attendance/sample-employees';
import { PERIOD_LABEL, metricsForPeriod, periodDays, type EmployeePeriodMetrics, type Period } from '@/lib/attendance/dashboard';

type MetricId = 'hours' | 'overtime' | 'leave' | 'late';

const METRICS: Record<MetricId, { label: string; unit: string; value: (m: EmployeePeriodMetrics) => number }> = {
  hours: { label: 'Most Hours Worked', unit: 'h', value: (m) => m.totalHours },
  overtime: { label: 'Most Overtime Hours', unit: 'h', value: (m) => m.overtimeHours },
  leave: { label: 'Most Leave Taken', unit: 'day(s)', value: (m) => m.leaveDays },
  late: { label: 'Most Late Arrivals', unit: '', value: (m) => m.lateCount },
};

const DEPARTMENTS = ['All Departments', ...Array.from(new Set(SAMPLE_EMPLOYEES.map((e) => e.department)))];

/** The dashboard's configurable leaderboard - ranks the team/org by whichever
 *  metric and time period is selected. Built on the same sample per-employee
 *  metrics as the rest of the dashboard (see lib/attendance/dashboard.ts). */
export function AttendanceLeaderboard() {
  const [metric, setMetric] = useState<MetricId>('hours');
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [department, setDepartment] = useState('All Departments');

  const days = useMemo(() => periodDays(period), [period]);
  const roster = useMemo(
    () => (department === 'All Departments' ? SAMPLE_EMPLOYEES : SAMPLE_EMPLOYEES.filter((e) => e.department === department)),
    [department],
  );
  const ranked = useMemo(() => {
    const rows = metricsForPeriod(days, roster);
    return [...rows].sort((a, b) => METRICS[metric].value(b) - METRICS[metric].value(a));
  }, [days, roster, metric]);

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
            {DEPARTMENTS.map((d) => (
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
            {ranked.map((m, i) => (
              <tr key={m.employee.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 text-sm font-semibold text-slate-400 whitespace-nowrap">{i + 1}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">{m.employee.name}</td>
                <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">{m.employee.department}</td>
                <td className="px-5 py-3 text-sm font-semibold text-indigo-700 whitespace-nowrap">
                  {config.value(m)}
                  {config.unit ? ` ${config.unit}` : ''}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">{m.presentDays}</td>
              </tr>
            ))}
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                  No employees match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
