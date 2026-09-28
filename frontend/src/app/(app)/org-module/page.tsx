'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { onboardingApi, type OnboardingRecordListItem } from '@/lib/api/onboarding';
import { exitsApi, type Resignation } from '@/lib/api/exits';
import { documentsApi } from '@/lib/api/documents';
import { ActivityTab } from '@/components/admin/ActivityTab';
import { PageHeader } from '@/components/org-module/ui';

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

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
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

export default function OrgDashboardPage() {
  const [tab, setTab] = useState<TabId>('summary');

  const [employees, setEmployees] = useState<OrgEmployee[] | null>(null);
  const [departments, setDepartments] = useState<NamedEntity[] | null>(null);
  const [locations, setLocations] = useState<NamedEntity[] | null>(null);
  const [positions, setPositions] = useState<OrgPosition[] | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingRecordListItem[] | null>(null);
  const [resignations, setResignations] = useState<Resignation[] | null>(null);
  const [myDocCount, setMyDocCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    // Each source is independent: a failing card (e.g. exits or onboarding,
    // which are role-gated) must not blank the headcount that loaded fine.
    // Only a core-directory failure raises the banner.
    const [directory, depts, locs, poss, onb, ext, mine] = await Promise.allSettled([
      orgApi.listDirectory(),
      orgApi.listDepartments(),
      orgApi.listLocations(),
      orgApi.listPositions(),
      onboardingApi.getRecords(),
      exitsApi.list(),
      documentsApi.mine(),
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

  const headcountByLocation = useMemo(
    () => (live ? groupByLocation(employees, locations) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, employees, locations],
  );

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

  const kpis = [
    { label: 'Total Employees', value: live ? employees.length : 0, note: 'Live from directory' },
    { label: 'Departments', value: live ? departments.length : 0, note: 'Live from directory' },
    { label: 'Locations', value: live ? locations.length : 0, note: 'Live from directory' },
    { label: 'Total Positions', value: totalPositions, note: 'Live from positions' },
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
    { label: 'Org Directory', href: '/org?tab=directory' },
    { label: 'Org Tree', href: '/org?tab=chart' },
  ];

  const bulkOps: { label: string; disabledNote: string }[] = [
    { label: 'Add employees', disabledNote: 'Coming soon' },
    { label: 'Update employees', disabledNote: 'Coming soon' },
    { label: 'Bulk invite employees', disabledNote: 'Coming soon' },
    { label: 'Import job details', disabledNote: 'Coming soon' },
    { label: 'Import custom fields', disabledNote: 'Coming soon' },
    { label: 'Bulk import documents', disabledNote: 'Coming soon' },
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

  /* ------------------------------- reports -------------------------------- */
  const quickReports: { label: string; desc: string; href?: string; disabledNote?: string }[] = [
    { label: 'Employee directory', desc: 'Live headcount list', href: '/org?tab=directory' },
    { label: 'Organisation chart', desc: 'Live reporting lines', href: '/org?tab=chart' },
    { label: 'Onboarding pipeline', desc: 'Live hire progress', href: '/onboarding' },
    { label: 'Exits', desc: 'Live resignation states', href: '/exits' },
  ];
  const otherReports: { label: string; disabledNote: string }[] = [
    { label: 'Headcount export', disabledNote: 'No export yet' },
    { label: 'Login activity', disabledNote: 'No data source yet' },
    { label: 'Probation report', disabledNote: 'No data source yet' },
    { label: 'Documents due', disabledNote: 'No data source yet' },
  ];

  return (
    <div className="w-full">
      <PageHeader
        title="Dashboard"
        subtitle="Headcount and structure are live from the employee directory; onboarding, exits and audit from their own services. Cards without a backend say so plainly."
      />

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

          {/* Pending actions + Quicklinks */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card
                title="Pending Actions"
                subtitle="Live from onboarding and exits; untracked areas show 0 plainly."
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
            <Card title="Quicklinks" subtitle="Shortcuts into the modules that exist.">
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
                      {q.label} · {q.disabledNote}
                    </span>
                  ),
                )}
              </div>
            </Card>
          </div>

          {/* Bulk operations + Login summary */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card
                title="Bulk operations"
                subtitle="Bulk flows are not built yet — every action below is disabled, not a dead link."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {bulkOps.map((b) => (
                    <span
                      key={b.label}
                      title={b.disabledNote}
                      aria-disabled="true"
                      className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-center cursor-not-allowed"
                    >
                      {b.label} · {b.disabledNote}
                    </span>
                  ))}
                </div>
              </Card>
            </div>
            <Card
              title="Employee Login Summary"
              subtitle="Sign-in analytics over the last 14 days."
            >
              <EmptyNote>
                Login analytics not available yet — no login-events backend.
              </EmptyNote>
            </Card>
          </div>

          {/* Headcount by department (kept) */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Headcount by Department"
              subtitle={
                loading
                  ? 'Loading…'
                  : `Live from the employee directory${live && exitedCount > 0 ? ` · ${exitedCount} exited (have an exit date)` : ''}`
              }
            >
              {loading ? (
                <div className="h-64 bg-slate-50 rounded-xl animate-pulse" />
              ) : headcountByDepartment.length === 0 ? (
                <EmptyNote>No employees in the directory yet.</EmptyNote>
              ) : (
                <div className="h-64">
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

            {/* Exits + Onboarding lists */}
            <div className="flex flex-col gap-4">
              <Card
                title={`Exits (${resignations === null ? '–' : activeExits.length})`}
                subtitle="Live from the exits service."
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
              <Card
                title={`Onboarding (${onboarding === null ? '–' : activeOnboarding.length})`}
                subtitle="Live from the onboarding service."
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Headcount by Department" subtitle={loading ? 'Loading…' : 'Live from the employee directory'}>
              {loading ? (
                <div className="h-64 bg-slate-50 rounded-xl animate-pulse" />
              ) : headcountByDepartment.length === 0 ? (
                <EmptyNote>No employees in the directory yet.</EmptyNote>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={headcountByDepartment} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="department" tick={{ fontSize: 11 }} interval={0} angle={-18} dy={10} height={52} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="headcount" name="Headcount" fill={DEPT_BAR_FILL} radius={[6, 6, 0, 0]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Breakdown" subtitle={loading ? 'Loading…' : 'Department and location shares from the live directory.'}>
              {loading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-24 bg-slate-50 rounded-xl" />
                  <div className="h-24 bg-slate-50 rounded-xl" />
                </div>
              ) : !live ? (
                <EmptyNote>Could not load the directory.</EmptyNote>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">By department</p>
                    <ul className="space-y-1.5">
                      {headcountByDepartment.map((d) => (
                        <li key={d.department} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-1.5">
                          <span className="text-slate-700 truncate">{d.department}</span>
                          <span className="font-bold text-slate-900 ml-2">{d.headcount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">By location</p>
                    <ul className="space-y-1.5">
                      {headcountByLocation.map((l) => (
                        <li key={l.location} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-1.5">
                          <span className="text-slate-700 truncate">{l.location}</span>
                          <span className="font-bold text-slate-900 ml-2">{l.headcount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div role="tabpanel" aria-label="Employee Reports">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Quick Reports" subtitle="Links into live pages; nothing here is a dead link.">
              <div className="flex flex-col gap-2">
                {quickReports.map((r) => (
                  <Link
                    key={r.label}
                    href={r.href!}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-sm font-semibold text-slate-700">{r.label}</span>
                    <span className="text-xs text-slate-400">{r.desc}</span>
                  </Link>
                ))}
              </div>
            </Card>
            <Card title="Other Reports" subtitle="No backend or export exists for these yet — all disabled, none a dead link.">
              <div className="flex flex-col gap-2">
                {otherReports.map((r) => (
                  <span
                    key={r.label}
                    title={r.disabledNote}
                    aria-disabled="true"
                    className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                  >
                    <span className="text-sm font-semibold">{r.label}</span>
                    <span className="text-xs">{r.disabledNote}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div role="tabpanel" aria-label="Audit Logs">
          <Card
            title="Audit Logs"
            subtitle="The same permanent record the Access-control Activity tab reads, via /api/admin/*. If your role cannot read it, it says so instead of failing silently."
          >
            <ActivityTab />
          </Card>
        </div>
      )}

    </div>
  );
}
