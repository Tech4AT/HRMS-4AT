'use client';

import { useEffect, useMemo, useState } from 'react';
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
  type CostCenter,
  type NamedEntity,
  type OrgEmployee,
} from '@/lib/api/org';
import type { Resignation } from '@/lib/api/exits';

const UNASSIGNED = 'Unassigned';
const DEPT_BAR_FILL = '#4f46e5';

/** Accessible categorical palette for pies. */
const PIE_FILLS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

type InnerTab = 'demographics' | 'growth' | 'attrition';

const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: 'demographics', label: 'Headcount by Demographics' },
  { id: 'growth', label: 'Growth & Retention' },
  { id: 'attrition', label: 'Attrition Analysis' },
];

const ATTRITION_TIME_GROUPS = [
  'Overall Attrition',
  'Years in Organisation',
  'Months since Salary Revision',
];
const ATTRITION_DEMO_GROUPS = [
  'Age',
  'Gender',
  'Exit Type',
  'Exit Reason',
  'Performance Rating',
  'Compensation Range',
];

function pretty(value: string): string {
  return value
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function groupBy(
  employees: OrgEmployee[],
  key: (e: OrgEmployee) => string,
  label: string,
) {
  const counts = new Map<string, number>();
  for (const e of employees) {
    const k = key(e) || UNASSIGNED;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, headcount]) => ({ name, [label]: headcount, headcount }))
    .sort((a, b) => b.headcount - a.headcount);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-slate-500">{children}</p>;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  disabledNote,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  disabledNote?: string;
}) {
  return (
    <label className="min-w-[150px] flex-1 sm:flex-none" title={disabled ? disabledNote : undefined}>
      <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AnalyticsTab({
  employees,
  departments,
  locations,
  resignations,
  loading,
  live,
}: {
  employees: OrgEmployee[] | null;
  departments: NamedEntity[] | null;
  locations: NamedEntity[] | null;
  resignations: Resignation[] | null;
  loading: boolean;
  live: boolean;
}) {
  const [inner, setInner] = useState<InnerTab>('demographics');

  // Shared filter bar state. Filters over absent dims (no dated records,
  // gender, age…) render but leave the empty panels untouched.
  const [fBU, setFBU] = useState('');
  const [fDept, setFDept] = useState('');
  const [fLoc, setFLoc] = useState('');
  const [fCC, setFCC] = useState('');
  const [fLE, setFLE] = useState('');
  const [fRange, setFRange] = useState('');
  const [fWorkerType, setFWorkerType] = useState('');
  const [fExitType, setFExitType] = useState('');

  const [businessUnits, setBusinessUnits] = useState<NamedEntity[] | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[] | null>(null);
  const [legalEntities, setLegalEntities] = useState<NamedEntity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bu, cc, le] = await Promise.allSettled([
        orgApi.listBusinessUnits(),
        orgApi.listCostCenters(),
        orgApi.listLegalEntities(),
      ]);
      if (cancelled) return;
      setBusinessUnits(bu.status === 'fulfilled' ? bu.value : null);
      setCostCenters(cc.status === 'fulfilled' ? cc.value : null);
      setLegalEntities(le.status === 'fulfilled' ? le.value : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearFilters = () => {
    setFBU('');
    setFDept('');
    setFLoc('');
    setFCC('');
    setFLE('');
    setFRange('');
    setFWorkerType('');
    setFExitType('');
  };
  const filtersActive =
    fBU !== '' ||
    fDept !== '' ||
    fLoc !== '' ||
    fCC !== '' ||
    fLE !== '' ||
    fRange !== '' ||
    fWorkerType !== '' ||
    fExitType !== '';

  const deptNames = useMemo(
    () => new Map((departments ?? []).map((d) => [d.id, d.name])),
    [departments],
  );
  const locNames = useMemo(
    () => new Map((locations ?? []).map((l) => [l.id, l.name])),
    [locations],
  );

  // Filters narrow the panels built on real dims. Absent dims (dates,
  // gender, age…) have no source field, so they cannot narrow anything.
  const filtered = useMemo(() => {
    if (!employees) return [];
    return employees.filter((e) => {
      if (fDept && (e.department_id ?? '') !== fDept) return false;
      if (fLoc && (e.location_id ?? '') !== fLoc) return false;
      if (fBU && (e.business_unit_id ?? '') !== fBU) return false;
      if (fCC && (e.cost_center_id ?? '') !== fCC) return false;
      if (fLE && (e.legal_entity_id ?? '') !== fLE) return false;
      if (fWorkerType && e.employment_type !== fWorkerType) return false;
      return true;
    });
  }, [employees, fDept, fLoc, fBU, fCC, fLE, fWorkerType]);

  const workerTypeOptions = useMemo(() => {
    const vals = new Set((employees ?? []).map((e) => e.employment_type).filter(Boolean));
    return [...vals].map((v) => ({ value: v, label: pretty(v) }));
  }, [employees]);

  const exitTypeOptions = useMemo(() => {
    const vals = new Set(
      (resignations ?? []).map((r) => r.statusDisplay).filter(Boolean),
    );
    return [...vals].map((v) => ({ value: v, label: v }));
  }, [resignations]);

  const byDept = useMemo(
    () =>
      groupBy(
        filtered,
        (e) => (e.department_id && deptNames.get(e.department_id)) || UNASSIGNED,
        'headcount',
      ),
    [filtered, deptNames],
  );
  const byLoc = useMemo(
    () =>
      groupBy(
        filtered,
        (e) => (e.location_id && locNames.get(e.location_id)) || UNASSIGNED,
        'headcount',
      ),
    [filtered, locNames],
  );
  const byStatus = useMemo(
    () => groupBy(filtered, (e) => pretty(e.status || UNASSIGNED), 'headcount'),
    [filtered],
  );
  const byType = useMemo(
    () =>
      groupBy(filtered, (e) => pretty(e.employment_type || UNASSIGNED), 'headcount'),
    [filtered],
  );

  // Growth & retention need dated join/exit records — the roster carries no
  // dates, so every rate is honestly blank. Total attrition is the one real
  // number: the live resignation count.
  const totalAttrition = resignations === null ? null : resignations.length;

  const [attrGroup, setAttrGroup] = useState('Overall Attrition');
  const [attrMetric, setAttrMetric] = useState<'count' | 'percent'>('count');

  return (
    <div>
      {/* Inner pill tab bar */}
      <div className="mb-4 flex gap-2 flex-wrap" role="tablist" aria-label="Analytics sections">
        {INNER_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={inner === t.id}
            onClick={() => setInner(t.id)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full border transition-colors ${
              inner === t.id
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared filter bar (real masters; absent dims render but don't filter) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Business Unit"
            value={fBU}
            onChange={setFBU}
            options={(businessUnits ?? []).map((b) => ({ value: b.id, label: b.name }))}
            disabled={businessUnits !== null && businessUnits.length === 0}
            disabledNote="No business units defined yet"
          />
          <FilterSelect
            label="Department"
            value={fDept}
            onChange={setFDept}
            options={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
          <FilterSelect
            label="Location"
            value={fLoc}
            onChange={setFLoc}
            options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))}
          />
          <FilterSelect
            label="Cost Center"
            value={fCC}
            onChange={setFCC}
            options={(costCenters ?? []).map((c) => ({
              value: c.id,
              label: c.code ? `${c.name} (${c.code})` : c.name,
            }))}
            disabled={costCenters !== null && costCenters.length === 0}
            disabledNote="No cost centers defined yet"
          />
          <FilterSelect
            label="Legal Entity"
            value={fLE}
            onChange={setFLE}
            options={(legalEntities ?? []).map((l) => ({ value: l.id, label: l.name }))}
            disabled={legalEntities !== null && legalEntities.length === 0}
            disabledNote="No legal entities defined yet"
          />
          <FilterSelect
            label="Date Range"
            value={fRange}
            onChange={setFRange}
            options={[
              { value: '30d', label: 'Last 30 days' },
              { value: 'quarter', label: 'Last quarter' },
              { value: 'year', label: 'Last year' },
            ]}
            disabledNote="Join/exit dates are not tracked yet"
          />
          <FilterSelect
            label="Worker Type"
            value={fWorkerType}
            onChange={setFWorkerType}
            options={workerTypeOptions}
          />
          {inner === 'attrition' ? (
            <FilterSelect
              label="Exit Types"
              value={fExitType}
              onChange={setFExitType}
              options={exitTypeOptions}
              disabled={exitTypeOptions.length === 0}
              disabledNote="No exits recorded yet"
            />
          ) : null}
          <button
            type="button"
            onClick={clearFilters}
            disabled={!filtersActive}
            title="Clear filters"
            aria-label="Clear filters"
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40"
          >
            ✕
          </button>
        </div>
      </div>

      {inner === 'demographics' && (
        <div role="tabpanel" aria-label="Headcount by Demographics">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse">
              <div className="h-72 bg-white border border-slate-200 rounded-xl" />
              <div className="h-72 bg-white border border-slate-200 rounded-xl" />
            </div>
          ) : !live ? (
            <Card title="Headcount by Demographics">
              <EmptyNote>Could not load the directory.</EmptyNote>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Headcount by Department">
                  {byDept.length === 0 ? (
                    <EmptyNote>No employees match these filters.</EmptyNote>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byDept} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11 }}
                            interval={0}
                            angle={-18}
                            dy={10}
                            height={52}
                          />
                          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="headcount" name="Headcount" fill={DEPT_BAR_FILL} radius={[6, 6, 0, 0]} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
                <Card title="Headcount by Location">
                  {byLoc.length === 0 ? (
                    <EmptyNote>No employees match these filters.</EmptyNote>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byLoc} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11 }}
                            interval={0}
                            angle={-18}
                            dy={10}
                            height={52}
                          />
                          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="headcount" name="Headcount" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
                <Card title="Headcount by Status">
                  {byStatus.length === 0 ? (
                    <EmptyNote>No employees match these filters.</EmptyNote>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={byStatus}
                            dataKey="headcount"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={90}
                            paddingAngle={2}
                          >
                            {byStatus.map((s, i) => (
                              <Cell key={s.name} fill={PIE_FILLS[i % PIE_FILLS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
                <Card title="Headcount by Employment Type">
                  {byType.length === 0 ? (
                    <EmptyNote>No employees match these filters.</EmptyNote>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={byType}
                            dataKey="headcount"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={90}
                            paddingAngle={2}
                          >
                            {byType.map((s, i) => (
                              <Cell key={s.name} fill={PIE_FILLS[i % PIE_FILLS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {['Gender', 'Age', 'Tenure'].map((label) => (
                  <Card key={label} title={`Headcount by ${label}`}>
                    <EmptyNote>Not tracked yet.</EmptyNote>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {inner === 'growth' && (
        <div role="tabpanel" aria-label="Growth, Exit and Retention">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Growth, Exit &amp; Retention</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              {
                label: 'Growth Rate',
                value: '—',
                tip: 'New joiners over the period divided by opening headcount. Needs join dates.',
              },
              {
                label: 'Retention Rate',
                value: '—',
                tip: 'Employees retained over the period divided by opening headcount. Needs join/exit dates.',
              },
              {
                label: 'Attrition Rate',
                value: '—',
                tip: 'Exits over the period divided by average headcount. Needs exit dates.',
              },
              {
                label: 'Total Attrition',
                value: totalAttrition === null ? '–' : String(totalAttrition),
                tip: 'Live count of recorded resignations.',
              },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-white border border-slate-200 border-l-4 border-l-indigo-500 rounded-xl p-4"
              >
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {k.label}{' '}
                  <span
                    title={k.tip}
                    aria-label={k.tip}
                    className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-slate-100 text-slate-500 cursor-help"
                  >
                    i
                  </span>
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {k.label === 'Total Attrition'
                    ? resignations === null
                      ? 'Could not load exits'
                      : 'Live from resignations'
                    : 'No dated records yet'}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Card title="Growth Rate">
              <EmptyNote>
                No dated records yet — join and exit dates are not tracked, so no
                trend can be drawn.
              </EmptyNote>
            </Card>
          </div>
        </div>
      )}

      {inner === 'attrition' && (
        <div role="tabpanel" aria-label="Attrition by Time and Demographics">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            Attrition by Time &amp; Demographics
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
            {/* Left rail */}
            <nav
              aria-label="Attrition breakdowns"
              className="bg-white border border-slate-200 rounded-xl p-3 h-fit"
            >
              <p className="px-2 pt-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                By Time
              </p>
              <ul className="mt-1 space-y-0.5">
                {ATTRITION_TIME_GROUPS.map((g) => (
                  <li key={g}>
                    <button
                      type="button"
                      onClick={() => setAttrGroup(g)}
                      aria-current={attrGroup === g ? 'true' : undefined}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                        attrGroup === g
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {g}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                By Demographics &amp; Other Parameters
              </p>
              <ul className="mt-1 space-y-0.5">
                {ATTRITION_DEMO_GROUPS.map((g) => (
                  <li key={g}>
                    <button
                      type="button"
                      onClick={() => setAttrGroup(g)}
                      aria-current={attrGroup === g ? 'true' : undefined}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                        attrGroup === g
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {g}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Main panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-slate-900">{attrGroup}</h4>
                <div
                  className="flex rounded-full border border-slate-200 overflow-hidden text-xs font-semibold"
                  role="group"
                  aria-label="Metric"
                >
                  {(
                    [
                      { id: 'count', label: 'Employee Count' },
                      { id: 'percent', label: 'Employee Percentage' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAttrMetric(m.id)}
                      aria-pressed={attrMetric === m.id}
                      className={`px-3 py-1.5 transition-colors ${
                        attrMetric === m.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 border border-slate-100 rounded-xl">
                <EmptyNote>
                  No exits recorded yet — nothing to chart
                  {attrMetric === 'percent' ? ' by percentage' : ' by count'}.
                </EmptyNote>
              </div>
              <div className="mt-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                  Insights
                </p>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Total attrition',
                      value: totalAttrition === null ? '–' : String(totalAttrition),
                    },
                    { label: 'Highest month', value: '—' },
                    { label: 'Lowest month', value: '—' },
                    { label: 'Average per month', value: '—' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="bg-slate-50 border border-slate-200 rounded-xl p-3"
                    >
                      <p className="text-[11px] font-semibold text-slate-500">{s.label}</p>
                      <p className="mt-0.5 text-xl font-bold text-slate-900">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
