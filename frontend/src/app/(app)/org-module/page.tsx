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
import {
  orgApi,
  type NamedEntity,
  type OrgEmployee,
  type OrgPosition,
} from '@/lib/api/org';
import {
  adminApi,
  HEADCOUNT_DIMENSIONS,
  type HeadcountBucket,
  type OrgAnalyticsSummary,
  type OrgHeadcountDimension,
} from '@/lib/admin/api';
import { onboardingApi, type OnboardingRecordListItem } from '@/lib/api/onboarding';
import { exitsApi, type Resignation } from '@/lib/api/exits';
import { documentsApi } from '@/lib/api/documents';
import { AnalyticsTab } from '@/components/org-module/analytics-tab';
import { ReportsTab } from '@/components/org-module/reports-tab';
import { AuditLogsTab } from '@/components/org-module/audit-logs-tab';

const UNASSIGNED = 'Unassigned';

/** Accessible categorical palette: distinct hues, dark-on-white safe. */
const DEPT_BAR_FILL = '#4f46e5';

type TabId = 'summary' | 'analytics' | 'reports' | 'audit';

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'reports', label: 'Employee Reports' },
  { id: 'audit', label: 'Audit Logs' },
];

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

function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl p-5 h-full ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {action}
      </div>
      {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-slate-500">{children}</p>;
}

/** Headcount breakdown with a dimension switcher backed by the live
 * GET org/analytics/headcount/?by= endpoint (org.read-gated). `seed` is the
 * summary's department buckets so first paint needs no extra request. */
function HeadcountBreakdownCard({ seed }: { seed: HeadcountBucket[] | null }) {
  const [dim, setDim] = useState<OrgHeadcountDimension>('department');
  const [buckets, setBuckets] = useState<HeadcountBucket[] | null>(seed);
  const [loadingDim, setLoadingDim] = useState(false);
  const [dimFailed, setDimFailed] = useState(false);

  useEffect(() => {
    setBuckets(seed);
  }, [seed]);

  useEffect(() => {
    let cancelled = false;
    // The seed already covers the default dimension.
    if (dim === 'department' && seed !== null) return;
    setLoadingDim(true);
    setDimFailed(false);
    adminApi
      .getOrgHeadcount(dim)
      .then((r) => {
        if (cancelled) return;
        setBuckets(r.buckets);
      })
      .catch(() => {
        if (cancelled) return;
        setDimFailed(true);
        setBuckets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDim(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim]);

  return (
    <Card
      title="Headcount breakdown"
      subtitle="Live from analytics"
      action={
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          By
          <select
            aria-label="Breakdown dimension"
            value={dim}
            onChange={(e) => setDim(e.target.value as OrgHeadcountDimension)}
            className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          >
            {HEADCOUNT_DIMENSIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {loadingDim ? (
        <div className="h-64 bg-slate-50 rounded-xl animate-pulse" />
      ) : dimFailed ? (
        <EmptyNote>Couldn&apos;t load this breakdown.</EmptyNote>
      ) : !buckets || buckets.length === 0 ? (
        <EmptyNote>No employees to break down yet.</EmptyNote>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={buckets.map((b) => ({ name: b.name, headcount: b.headcount }))}
              margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-18}
                dy={10}
                height={52}
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
    </Card>
  );
}

/** Per-location breakdown (Keka "Locations" card): employees and distinct
 * departments at each location, derived from the directory. No thumbnails or
 * country data in our model — name + counts only. */
function LocationsCard({
  employees,
  locations,
}: {
  employees: OrgEmployee[];
  locations: NamedEntity[];
}) {
  const rows = useMemo(() => {
    const byLoc = new Map<string, { emps: number; depts: Set<string> }>();
    for (const e of employees) {
      const loc = e.location_id;
      if (!loc) continue;
      const rec = byLoc.get(loc) ?? { emps: 0, depts: new Set<string>() };
      rec.emps += 1;
      if (e.department_id) rec.depts.add(e.department_id);
      byLoc.set(loc, rec);
    }
    return locations
      .map((l) => ({
        id: l.id,
        name: l.name,
        emps: byLoc.get(l.id)?.emps ?? 0,
        depts: byLoc.get(l.id)?.depts.size ?? 0,
      }))
      .sort((a, b) => b.emps - a.emps);
  }, [employees, locations]);

  return (
    <Card
      title="Locations"
      action={
        <Link href="/org-module/locations" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          View All →
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyNote>No locations yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" /></svg>
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800 truncate">{r.name}</span>
              <span className="text-center shrink-0 w-16">
                <span className="block text-sm font-bold text-slate-900">{r.emps}</span>
                <span className="block text-[10px] uppercase tracking-wide text-slate-400">Employees</span>
              </span>
              <span className="text-center shrink-0 w-20">
                <span className="block text-sm font-bold text-slate-900">{r.depts}</span>
                <span className="block text-[10px] uppercase tracking-wide text-slate-400">Departments</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const POSITION_STATUS_META: { key: string; label: string; color: string }[] = [
  { key: 'filled', label: 'Filled', color: '#2563eb' },
  { key: 'vacant', label: 'Vacant', color: '#ec4899' },
  { key: 'hiring', label: 'Hiring', color: '#8b5cf6' },
  { key: 'on_hold', label: 'On Hold', color: '#f59e0b' },
];

/** Position Overview donut (Keka): positions grouped by status, total in the
 * centre. Built from the live positions list. */
function PositionOverviewCard({ positions }: { positions: OrgPosition[] }) {
  const { data, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of positions) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    const data = POSITION_STATUS_META.map((m) => ({ ...m, value: counts.get(m.key) ?? 0 }));
    return { data, total: positions.length };
  }, [positions]);

  return (
    <Card title="Position Overview">
      {total === 0 ? (
        <EmptyNote>No positions yet.</EmptyNote>
      ) : (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none">
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-slate-900">{total}</span>
              <span className="text-[11px] text-slate-400">Positions</span>
            </div>
          </div>
          <ul className="flex-1 min-w-[8rem] space-y-2">
            {data.map((d) => (
              <li key={d.key} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="flex-1 text-slate-600">{d.label}</span>
                <span className="font-bold text-slate-900">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function OrgDashboardPage() {
  const [tab, setTab] = useState<TabId>('summary');

  const [employees, setEmployees] = useState<OrgEmployee[] | null>(null);
  const [departments, setDepartments] = useState<NamedEntity[] | null>(null);
  const [locations, setLocations] = useState<NamedEntity[] | null>(null);
  const [positions, setPositions] = useState<OrgPosition[] | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingRecordListItem[] | null>(null);
  const [resignations, setResignations] = useState<Resignation[] | null>(null);
  const [myDocCount, setMyDocCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<OrgAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    // Each source is independent: a failing card (e.g. exits or onboarding,
    // which are role-gated) must not blank the headcount that loaded fine.
    // Only a core-directory failure raises the banner.
    const [directory, depts, locs, poss, onb, ext, mine, summ] = await Promise.allSettled([
      orgApi.listDirectory(),
      orgApi.listDepartments(),
      orgApi.listLocations(),
      orgApi.listPositions(),
      onboardingApi.getRecords(),
      exitsApi.list(),
      documentsApi.mine(),
      // Analytics summary is permission-gated (org.read): a 403 here must not
      // blank the directory-driven cards below.
      adminApi.getOrgAnalyticsSummary(),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' ? r.value : null;
    setEmployees(val(directory));
    setDepartments(val(depts));
    setLocations(val(locs));
    setPositions(val(poss));
    setOnboarding(val(onb));
    setResignations(val(ext));
    setMyDocCount(mine.status === 'fulfilled' ? mine.value.length : null);
    setSummary(summ.status === 'fulfilled' ? summ.value : null);
    setLoadFailed(
      directory.status === 'rejected' &&
        depts.status === 'rejected' &&
        locs.status === 'rejected',
    );
    setLoading(false);
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

  const totalPositions = positions?.length ?? 0;
  const vacantPositions = useMemo(
    () => positions?.filter((p) => p.status === 'vacant').length ?? 0,
    [positions],
  );
  const filledPositions = useMemo(
    () => positions?.filter((p) => p.status === 'filled').length ?? 0,
    [positions],
  );

  const kpis = [
    {
      label: 'Total Headcount',
      value: summary !== null ? summary.total_headcount : live ? employees.length : 0,
      note: summary !== null ? 'Live from analytics' : 'Live from directory',
    },
    { label: 'Departments', value: live ? departments.length : 0, note: 'Live from directory' },
    { label: 'Locations', value: live ? locations.length : 0, note: 'Live from directory' },
    {
      label: 'Total Positions',
      value: totalPositions,
      note: totalPositions ? `${filledPositions} Filled · ${vacantPositions} Vacant` : 'Live from positions',
    },
    { label: 'Vacant Positions', value: vacantPositions, note: 'Live from positions' },
  ];

  /* ------------------------- pending actions (real) ------------------------- */
  // There is no org-wide "pending documents" endpoint: the documents API is
  // scoped per entity, so the Documents tile counts the signed-in user's own
  // record (documentsApi.mine) and says so. Onboarding tiles count active
  // hires; the list endpoint carries no per-task rows, so task-level
  // breakdowns are not shown.
  const activeOnboarding = useMemo(
    () => (onboarding ?? []).filter((r) => r.stage !== 'completed'),
    [onboarding],
  );
  const activeExits = useMemo(
    () =>
      (resignations ?? []).filter((r) => r.status === 'submitted' || r.status === 'accepted'),
    [resignations],
  );

  const pendingTiles: {
    label: string;
    value: number | null;
    note: string;
    href?: string;
  }[] = [
    {
      label: 'Documents',
      value: myDocCount,
      note:
        myDocCount === null ? 'Could not load documents' : 'Files on my own record',
      href: '/me/documents',
    },
    {
      label: 'Onboarding Tasks',
      value: onboarding === null ? null : activeOnboarding.length,
      note:
        onboarding === null ? 'Could not load onboarding' : 'Active hires in onboarding',
      href: '/onboarding',
    },
    {
      label: 'Exit Tasks',
      value: resignations === null ? null : activeExits.length,
      note:
        resignations === null ? 'Could not load exits' : 'Resignations awaiting completion',
      href: '/exits',
    },
    { label: 'Expenses', value: 0, note: 'Not tracked yet' },
    { label: 'Probations', value: 0, note: 'Not tracked yet' },
    { label: 'Profile changes', value: 0, note: 'Not tracked yet' },
  ];

  /* ------------------------------ quicklinks ------------------------------ */
  const quicklinks: { label: string; href?: string; disabledNote?: string }[] = [
    { label: 'New Employee', href: '/org?tab=directory' },
    { label: 'New Poll', href: '/engage' },
    { label: 'New Announcement', href: '/engage' },
    { label: 'Employee Custom Fields', disabledNote: 'No page yet' },
    { label: 'Employee Directory', href: '/org?tab=directory' },
    { label: 'Organisation Chart', href: '/org?tab=chart' },
  ];


  /* --------------------------- exits / onboarding --------------------------- */
  const deptNames = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d.name])), [departments]);

  const exitsRows = useMemo(() => {
    if (!resignations) return [];
    return [...resignations]
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        name: r.employee.name,
        dept: r.employee.department ?? '—',
        date: r.lastWorkingDay ?? r.requestedLastDay,
        status: r.statusDisplay,
      }));
  }, [resignations]);

  const onboardingRows = useMemo(() => {
    if (!onboarding) return [];
    return [...activeOnboarding]
      .sort((a, b) => (a.joiningDate ?? '').localeCompare(b.joiningDate ?? ''))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        name: r.employee.name,
        dept:
          r.employee.departmentId != null
            ? (deptNames.get(String(r.employee.departmentId)) ?? '—')
            : '—',
        date: r.joiningDate,
        pct: r.progress.percent,
      }));
  }, [onboarding, activeOnboarding, deptNames]);

  return (
    <div className="w-full">
      {/* Sub-tabs */}
      <div className="mb-4 flex gap-1 flex-wrap border-b border-slate-200" role="tablist" aria-label="Org dashboard sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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

      {tab === 'summary' && (
        <div role="tabpanel" aria-label="Summary">
          {/* KPI cards (unchanged) */}
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

          {/* Bento grid: proportioned tiles in one cohesive 6-column grid.
             Each child sets its own col-span; Card is h-full so a row's cards
             align. Bulk operations moved to Settings (org-configuration). */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 auto-rows-auto gap-4">
            {/* Headcount breakdown — vertical bar chart, dominant tile */}
            <div className="md:col-span-2 lg:col-span-4">
              {loading ? (
                <Card title="Headcount breakdown">
                  <div className="h-64 bg-slate-50 rounded-xl animate-pulse" />
                </Card>
              ) : (
                <HeadcountBreakdownCard seed={summary?.by_department ?? headcountByDepartment.map((d) => ({ id: null, name: d.department, headcount: d.headcount }))} />
              )}
            </div>

            {/* Position overview donut */}
            <div className="md:col-span-2 lg:col-span-2">
              {loading ? (
                <Card title="Position overview"><div className="h-64 bg-slate-50 rounded-xl animate-pulse" /></Card>
              ) : (
                <PositionOverviewCard positions={positions ?? []} />
              )}
            </div>

            {/* Pending actions — wide */}
            <div className="md:col-span-2 lg:col-span-4">
              <Card
                title="Pending Actions"
                action={
                  <Link href="/onboarding" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                    View all
                  </Link>
                }
              >
                {loading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-pulse">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-20 bg-slate-50 rounded-xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {pendingTiles.map((t) => {
                      const inner = (
                        <>
                          <p className="text-xs font-semibold text-slate-500">{t.label}</p>
                          <p className="mt-1 text-2xl font-bold text-slate-900">
                            {t.value === null ? '–' : t.value}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{t.note}</p>
                        </>
                      );
                      return t.href && t.value !== null ? (
                        <Link
                          key={t.label}
                          href={t.href}
                          className="bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100 transition-colors"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div
                          key={t.label}
                          className="bg-slate-50 border border-slate-200 rounded-xl p-3"
                          title={t.href ? undefined : t.note}
                        >
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Quicklinks — narrow */}
            <div className="md:col-span-2 lg:col-span-2">
              <Card title="Quicklinks">
                <div className="flex flex-col gap-2">
                  {quicklinks.map((q) =>
                    q.href ? (
                      <Link
                        key={q.label}
                        href={q.href}
                        className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors text-center"
                      >
                        {q.label}
                      </Link>
                    ) : (
                      <span
                        key={q.label}
                        title={q.disabledNote}
                        aria-disabled="true"
                        className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-center cursor-not-allowed"
                      >
                        {q.label}
                      </span>
                    ),
                  )}
                </div>
              </Card>
            </div>

            {/* Locations — half */}
            <div className="md:col-span-1 lg:col-span-3">
              {loading ? (
                <Card title="Locations"><div className="h-40 bg-slate-50 rounded-xl animate-pulse" /></Card>
              ) : (
                <LocationsCard employees={employees ?? []} locations={locations ?? []} />
              )}
            </div>

            {/* Login summary — half */}
            <div className="md:col-span-1 lg:col-span-3">
              <Card title="Employee Login Summary">
                <EmptyNote>
                  Login analytics not available yet — no login-events backend.
                </EmptyNote>
              </Card>
            </div>

            {/* Exits — half */}
            <div className="md:col-span-1 lg:col-span-3">
              <Card
                title={`Exits (${resignations === null ? '–' : activeExits.length})`}
                action={
                  <Link href="/exits" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                    View all
                  </Link>
                }
              >
                {loading ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-12 bg-slate-50 rounded-xl" />
                    <div className="h-12 bg-slate-50 rounded-xl" />
                  </div>
                ) : resignations === null ? (
                  <EmptyNote>Could not load exits.</EmptyNote>
                ) : exitsRows.length === 0 ? (
                  <EmptyNote>No exits recorded.</EmptyNote>
                ) : (
                  <ul className="space-y-2">
                    {exitsRows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                          <p className="text-xs text-slate-500">{r.dept} · last day {r.date}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-500 shrink-0">{r.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Onboarding — half */}
            <div className="md:col-span-1 lg:col-span-3">
              <Card
                title={`Onboarding (${onboarding === null ? '–' : activeOnboarding.length})`}
                action={
                  <Link href="/onboarding" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                    View all
                  </Link>
                }
              >
                {loading ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-12 bg-slate-50 rounded-xl" />
                    <div className="h-12 bg-slate-50 rounded-xl" />
                  </div>
                ) : onboarding === null ? (
                  <EmptyNote>Could not load onboarding.</EmptyNote>
                ) : onboardingRows.length === 0 ? (
                  <EmptyNote>No onboarding in progress.</EmptyNote>
                ) : (
                  <ul className="space-y-2">
                    {onboardingRows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                          <p className="text-xs text-slate-500">{r.dept} · joins {r.date}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-500 shrink-0">{r.pct}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <div role="tabpanel" aria-label="Analytics">
          <AnalyticsTab
            employees={employees}
            departments={departments}
            locations={locations}
            resignations={resignations}
            loading={loading}
            live={live}
          />
        </div>
      )}

      {tab === 'reports' && (
        <div role="tabpanel" aria-label="Employee Reports">
          <ReportsTab />
        </div>
      )}

      {tab === 'audit' && (
        <div role="tabpanel" aria-label="Audit Logs">
          <AuditLogsTab />
        </div>
      )}

    </div>
  );
}
