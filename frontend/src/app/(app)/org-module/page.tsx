'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/lib/auth/useAuth';
import {
  fullName,
  orgApi,
  type NamedEntity,
  type OrgEmployee,
  type OrgPosition,
} from '@/lib/api/org';
import { orgChangesApi, type OrgChange } from '@/lib/api/orgchanges';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

const UNASSIGNED = 'Unassigned';

/** Accessible categorical palette: distinct hues, dark-on-white safe. */
const DEPT_BAR_FILL = '#4f46e5';
const LOCATION_BAR_FILL = '#0284c7';

const POSITION_SLICES = [
  { key: 'filled', label: 'Filled', fill: '#059669' },
  { key: 'vacant', label: 'Vacant', fill: '#e11d48' },
  { key: 'hiring', label: 'Hiring', fill: '#4f46e5' },
  { key: 'on_hold', label: 'On Hold', fill: '#d97706' },
] as const;

const CHANGE_STATUS_LABEL: Record<OrgChange['status'], string> = {
  pending: 'Pending',
  effective: 'Effective',
  cancelled: 'Cancelled',
};

function groupByDepartment(employees: OrgEmployee[], departments: NamedEntity[]) {
  const names = new Map(departments.map((d) => [d.id, d.name]));
  const counts = new Map<string, number>();
  for (const e of employees) {
    const key = (e.department_id && names.get(e.department_id)) || UNASSIGNED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([department, headcount]) => ({ department, headcount }))
    .sort((a, b) => b.headcount - a.headcount);
}

function groupByLocation(employees: OrgEmployee[], locations: NamedEntity[]) {
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const counts = new Map<string, number>();
  for (const e of employees) {
    const key = (e.location_id && names.get(e.location_id)) || UNASSIGNED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([location, headcount]) => ({ location, headcount }))
    .sort((a, b) => b.headcount - a.headcount);
}

function changeSummary(c: OrgChange): string {
  const from = String(c.from_data?.name ?? c.from_data?.title ?? '').trim();
  const to = String(c.to_data?.name ?? c.to_data?.title ?? '').trim();
  if (from && to) return `${from} → ${to}`;
  if (to) return `→ ${to}`;
  return 'Details recorded';
}

export default function OrgOverviewPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [employees, setEmployees] = useState<OrgEmployee[] | null>(null);
  const [departments, setDepartments] = useState<NamedEntity[] | null>(null);
  const [locations, setLocations] = useState<NamedEntity[] | null>(null);
  const [positions, setPositions] = useState<OrgPosition[] | null>(null);
  const [changes, setChanges] = useState<OrgChange[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [directory, depts, locs, poss, chgs] = await Promise.all([
        orgApi.listDirectory(),
        orgApi.listDepartments(),
        orgApi.listLocations(),
        orgApi.listPositions(),
        orgChangesApi.list(),
      ]);
      setEmployees(directory);
      setDepartments(depts);
      setLocations(locs);
      setPositions(poss);
      setChanges(chgs);
    } catch {
      // Never an error screen: empty states with a banner + retry, no sample data.
      setEmployees(null);
      setDepartments(null);
      setLocations(null);
      setPositions(null);
      setChanges(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const live = employees !== null && departments !== null && locations !== null;

  const headcountByDepartment = useMemo(
    () => (live ? groupByDepartment(employees, departments) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees, departments],
  );

  const headcountByLocation = useMemo(
    () => (live ? groupByLocation(employees, locations) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees, locations],
  );

  const positionBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of positions ?? []) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    return POSITION_SLICES.map((s) => ({ ...s, value: counts.get(s.key) ?? 0 })).filter(
      (s) => s.value > 0,
    );
  }, [positions]);

  const totalPositions = positions?.length ?? 0;
  const vacantPositions = useMemo(
    () => positions?.filter((p) => p.status === 'vacant').length ?? 0,
    [positions],
  );

  // Exits come straight from the directory: anyone carrying an exit date.
  const exitedCount = useMemo(
    () => (live ? employees.filter((e) => e.date_of_exit).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees],
  );

  const employeeNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees ?? []) m.set(e.id, fullName(e));
    return m;
  }, [employees]);

  const recentChanges = useMemo(() => {
    if (!changes) return [];
    return [...changes]
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .slice(0, 5);
  }, [changes]);

  const kpis = [
    { label: 'Total Employees', value: live ? employees.length : 0, note: 'Live from directory' },
    { label: 'Departments', value: live ? departments.length : 0, note: 'Live from directory' },
    { label: 'Locations', value: live ? locations.length : 0, note: 'Live from directory' },
    { label: 'Total Positions', value: totalPositions, note: 'Live from positions' },
    { label: 'Vacant Positions', value: vacantPositions, note: 'Live from positions' },
  ];

  const quickActions = [
    { label: 'View organisation chart', href: '/org?tab=chart' },
    { label: 'Manage departments', href: '/org-module/departments' },
    { label: 'Manage teams', href: '/org-module/teams' },
    { label: 'Review org changes', href: '/org-module/promotions' },
  ];

  return (
    <div className="w-full">
      <PageHeader
        title="Org Overview"
        subtitle="Headcount and structure are live from the employee directory; positions from the positions registry; changes from the org-changes log."
      />

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            Couldn&apos;t reach the org data — showing empty states. Nothing here is sample data.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4" aria-label="Loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
              <div className="h-3 w-20 bg-slate-100 rounded" />
              <div className="mt-2 h-7 w-12 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{k.note}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Headcount by department */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900">Headcount by Department</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {loading ? 'Loading…' : 'Live from the employee directory'}
            {live && exitedCount > 0 ? ` · ${exitedCount} exited (have an exit date)` : ''}
          </p>
          {loading ? (
            <div className="mt-3 h-64 bg-slate-50 rounded-xl animate-pulse" />
          ) : headcountByDepartment.length === 0 ? (
            <p className="mt-3 py-12 text-center text-sm text-slate-500">
              No employees in the directory yet.
            </p>
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={headcountByDepartment} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="department"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-18}
                    dy={10}
                    height={52}
                    label={{ value: '', position: 'insideBottom' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    allowDecimals={false}
                    label={{ value: 'Headcount', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <Tooltip />
                  <Bar dataKey="headcount" name="Headcount" fill={DEPT_BAR_FILL} radius={[6, 6, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Position status donut */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900">Position Status</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {loading ? 'Loading…' : 'Live from the positions registry — a position exists even when vacant.'}
          </p>
          {loading ? (
            <div className="mt-3 h-64 bg-slate-50 rounded-xl animate-pulse" />
          ) : positionBreakdown.length === 0 ? (
            <p className="mt-3 py-12 text-center text-sm text-slate-500">
              No positions registered yet.
            </p>
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={positionBreakdown}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    strokeWidth={2}
                    stroke="#ffffff"
                  >
                    {positionBreakdown.map((s) => (
                      <Cell key={s.key} fill={s.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Headcount by location */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900">Headcount by Location</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {loading ? 'Loading…' : 'Live from the employee directory'}
          </p>
          {loading ? (
            <div className="mt-3 h-64 bg-slate-50 rounded-xl animate-pulse" />
          ) : headcountByLocation.length === 0 ? (
            <p className="mt-3 py-12 text-center text-sm text-slate-500">No locations yet.</p>
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={headcountByLocation}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="location" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip />
                  <Bar dataKey="headcount" name="Headcount" fill={LOCATION_BAR_FILL} radius={[0, 6, 6, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Recent org changes */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Recent Org Changes</h3>
            <Link
              href="/org-module/promotions"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              View all
            </Link>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Live from the org-changes log.</p>
          {loading ? (
            <div className="mt-3 space-y-3 animate-pulse">
              <div className="h-16 bg-slate-50 rounded-xl" />
              <div className="h-16 bg-slate-50 rounded-xl" />
            </div>
          ) : recentChanges.length === 0 ? (
            <p className="mt-3 py-12 text-center text-sm text-slate-500">
              No org changes recorded yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {recentChanges.map((c) => (
                <li key={c.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">
                      {employeeNames.get(c.employee_id) ?? 'Unknown employee'}
                    </p>
                    <StatusPill value={CHANGE_STATUS_LABEL[c.status]} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {changeSummary(c)} · effective {c.effective_date}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick actions */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 h-max">
          <h3 className="text-sm font-bold text-slate-900">Quick Actions</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {canManage
              ? 'Directory reads are live; add/edit actions save through the real endpoints.'
              : 'Some actions need org management access.'}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.href + a.label}
                href={a.href}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors text-center"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
