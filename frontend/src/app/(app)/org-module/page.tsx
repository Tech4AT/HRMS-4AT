'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/lib/auth/useAuth';
import { orgApi, type NamedEntity, type OrgEmployee } from '@/lib/api/org';
// mock: no backend yet — positions and org-change history have no endpoints,
// so these two cards stay on sample data until the backend models them.
import {
  positionSummary,
  recentOrgChanges,
  totalPositions as mockTotalPositions,
  vacantPositions as mockVacantPositions,
  headcountByDepartment as mockHeadcountByDepartment,
  locationSummary as mockLocationSummary,
  departments as mockDepartments,
  locations as mockLocations,
  totalEmployees as mockTotalEmployees,
} from '@/lib/mock/org/data';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

const positionColors: Record<string, string> = {
  Filled: 'bg-emerald-500',
  Vacant: 'bg-rose-500',
  Hiring: 'bg-indigo-500',
  'On Hold': 'bg-amber-500',
};

const UNASSIGNED = 'Unassigned';

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

export default function OrgOverviewPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [employees, setEmployees] = useState<OrgEmployee[] | null>(null);
  const [departments, setDepartments] = useState<NamedEntity[] | null>(null);
  const [locations, setLocations] = useState<NamedEntity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [emps, depts, locs] = await Promise.all([
        orgApi.listEmployees(),
        orgApi.listDepartments(),
        orgApi.listLocations(),
      ]);
      setEmployees(emps);
      setDepartments(depts);
      setLocations(locs);
    } catch {
      // Never an error screen: fall back to sample data with a banner + retry.
      setEmployees(null);
      setDepartments(null);
      setLocations(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live directory where available, sample data as a non-crashing fallback.
  const live = employees !== null && departments !== null && locations !== null;
  const totalEmployees = live ? employees.length : mockTotalEmployees;
  const deptCount = live ? departments.length : mockDepartments.length;
  const locCount = live ? locations.length : mockLocations.length;

  const headcountByDepartment = useMemo(
    () =>
      live
        ? groupByDepartment(employees, departments)
        : mockHeadcountByDepartment,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees, departments],
  );

  const locationSummary = useMemo(
    () =>
      live
        ? groupByLocation(employees, locations)
        : mockLocationSummary,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees, locations],
  );

  // Exits come straight from the directory: anyone carrying an exit date.
  const exitedCount = useMemo(
    () =>
      live
        ? employees.filter((e) => e.date_of_exit).length
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees],
  );

  const kpis = [
    { label: 'Total Employees', value: totalEmployees, note: live ? 'live' : 'sample' },
    { label: 'Departments', value: deptCount, note: live ? 'live' : 'sample' },
    { label: 'Locations', value: locCount, note: live ? 'live' : 'sample' },
    // mock: no backend yet — no positions endpoint, so these stay planned.
    { label: 'Total Positions', value: mockTotalPositions, note: 'planned' },
    { label: 'Vacant Positions', value: mockVacantPositions, note: 'planned' },
  ];

  const quickActions = [
    { label: 'View organisation chart', href: '/org?tab=chart' },
    { label: 'Manage departments', href: '/org-module/departments' },
    { label: 'Manage teams', href: '/org-module/teams' },
    { label: 'Review org changes', href: '/org-module/promotions' },
  ];

  return (
    <div>
      <PageHeader
        title="Org Overview"
        subtitle="Headcount and structure are live from the employee directory; positions are planned, not stored yet."
      />

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            Couldn&apos;t reach the employee directory — showing sample data.
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4" aria-label="Loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
              <div className="h-3 w-20 bg-slate-100 rounded" />
              <div className="mt-2 h-7 w-12 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {k.note === 'live' ? 'Live from directory' : k.note === 'planned' ? 'Planned · mock' : 'Sample data'}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Headcount by department */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900">Headcount by Department</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {live ? 'Live from the employee directory' : loading ? 'Loading…' : 'Sample data'}
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
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} interval={0} angle={-18} dy={10} height={52} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="headcount" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Position status */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900">Position Status</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            A position exists even when vacant — {mockTotalPositions} positions in total. (Planned · mock: no
            backend yet.)
          </p>
          <ul className="mt-4 space-y-3">
            {positionSummary.map((p) => (
              <li key={p.status}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{p.status}</span>
                  <span className="font-bold text-slate-900">{p.count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${positionColors[p.status] ?? 'bg-slate-400'}`}
                    style={{ width: `${Math.round((p.count / mockTotalPositions) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <h4 className="text-sm font-bold text-slate-900">Locations</h4>
            {loading ? (
              <div className="mt-2 space-y-2 animate-pulse">
                <div className="h-4 bg-slate-100 rounded" />
                <div className="h-4 bg-slate-100 rounded" />
              </div>
            ) : locationSummary.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No locations yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {locationSummary.map((l) => (
                  <li key={l.location} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">{l.location}</span>
                    <span className="font-semibold text-slate-900">{l.headcount}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          <p className="text-xs text-slate-400 mt-0.5">Sample data — no change-history endpoint yet.</p>
          <ul className="mt-3 space-y-3">
            {recentOrgChanges.map((c) => (
              <li key={c.id} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900">{c.subject}</p>
                  <StatusPill value={c.status} />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {c.type} · {c.from} → {c.to} · effective {c.effectiveDate} · by {c.changedBy}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Quick actions */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 h-max">
          <h3 className="text-sm font-bold text-slate-900">Quick Actions</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {canManage
              ? 'Directory reads are live; add/edit actions are still stubs — nothing is saved.'
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
