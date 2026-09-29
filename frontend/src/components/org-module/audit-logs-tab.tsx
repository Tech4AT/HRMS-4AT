'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  EMPLOYEE_ACTIVITY_CATEGORIES,
  formatWhen,
  humanizeAction,
  type AuditEntry,
  type EmployeeActivityEntry,
  type Page,
} from '@/lib/admin/api';

const PAGE_SIZE = 10;

type View = 'activity' | 'system';

/** "2026-09-28T…" -> "Sep 2026": the month bucket the entry belongs to. */
function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-t border-slate-200">
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages} · {from} to {to} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="min-w-[130px] flex-1 sm:flex-none">
      <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
        {label}
      </span>
      <input
        aria-label={label}
        type={type ?? 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="min-w-[130px] flex-1 sm:flex-none">
      <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Per-employee activity feed: the employee-facing answer to the Audit tab. */
function EmployeeActivityView() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<EmployeeActivityEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [fEmployee, setFEmployee] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fAction, setFAction] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  // Applied snapshot: the table queries only on Search, not on each keystroke.
  const [applied, setApplied] = useState({
    employee: '',
    category: '',
    action: '',
    date_from: '',
    date_to: '',
  });

  const load = useCallback(async () => {
    try {
      setData(
        await adminApi.listEmployeeActivity({
          ...applied,
          page,
          pageSize: PAGE_SIZE,
        }),
      );
      setError(null);
      setForbidden(false);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load employee activity.');
      }
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const applyFilters = () => {
    setPage(1);
    setApplied({
      employee: fEmployee.trim(),
      category: fCategory,
      action: fAction.trim(),
      date_from: fFrom,
      date_to: fTo,
    });
  };

  const clearFilters = () => {
    setFEmployee('');
    setFCategory('');
    setFAction('');
    setFFrom('');
    setFTo('');
    setPage(1);
    setApplied({ employee: '', category: '', action: '', date_from: '', date_to: '' });
  };

  const total = data?.total ?? 0;

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterInput
            label="Employee ID"
            value={fEmployee}
            onChange={setFEmployee}
            placeholder="e.g. 12"
          />
          <FilterSelect
            label="Category"
            value={fCategory}
            onChange={setFCategory}
            options={EMPLOYEE_ACTIVITY_CATEGORIES}
          />
          <FilterInput
            label="Action"
            value={fAction}
            onChange={setFAction}
            placeholder="e.g. auth.login_succeeded"
          />
          <FilterInput label="From" value={fFrom} onChange={setFFrom} type="date" />
          <FilterInput label="To" value={fTo} onChange={setFTo} type="date" />
          <button
            type="button"
            onClick={applyFilters}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Search
          </button>
          <button
            type="button"
            onClick={clearFilters}
            title="Clear filters"
            aria-label="Clear filters"
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {forbidden ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            You don&apos;t have access to employee activity — it needs the audit
            read permission.
          </p>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-500">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !data ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
        ) : data.results.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['When', 'Employee', 'Actor', 'Action', 'Summary'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {formatWhen(e.occurredAt)}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {e.employee?.name ?? '—'}
                      {e.employee ? (
                        <span className="block text-xs font-normal text-slate-500">
                          {e.employee.code}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {e.actor?.name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {humanizeAction(e.action)}
                      <span className="block text-xs font-normal text-slate-400">
                        {e.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-md">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && !forbidden && !error && data.results.length > 0 && (
          <Pager page={data.page} total={total} onPage={setPage} />
        )}
      </div>
    </div>
  );
}

/** Raw system audit log, kept behind a secondary toggle. */
function SystemAuditView() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AuditEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.listAudit({ page, pageSize: PAGE_SIZE }));
      setError(null);
      setForbidden(false);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load audit logs.');
      }
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const total = data?.total ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200">
        <h4 className="text-sm font-bold text-slate-900">This Month</h4>
      </div>

      {forbidden ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">
          You don&apos;t have access to audit logs — they need the audit read
          permission.
        </p>
      ) : error ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
      ) : data.results.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">No records found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Created On', 'Date Range', 'Category', 'Sub Category', 'Event'].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.results.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                    {formatWhen(e.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                    {monthLabel(e.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-slate-700">{e.entityType || '—'}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {e.entityId ? `#${e.entityId}` : '—'}
                  </td>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    {humanizeAction(e.action)}
                    {e.actorName ? (
                      <span className="block text-xs font-normal text-slate-500">
                        by {e.actorName}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && !forbidden && !error && data.results.length > 0 && (
        <Pager page={data.page} total={total} onPage={setPage} />
      )}
    </div>
  );
}

export function AuditLogsTab() {
  const [view, setView] = useState<View>('activity');

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {view === 'activity' ? 'Employee activity' : 'Audit logs'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {view === 'activity'
              ? 'Logins, profile, role, lifecycle and organisation changes per employee'
              : 'Track and review all user actions and changes within the system'}
          </p>
        </div>
        <div
          className="flex rounded-full border border-slate-200 overflow-hidden text-xs font-semibold"
          role="group"
          aria-label="Audit view"
        >
          {(
            [
              { id: 'activity', label: 'Employee activity' },
              { id: 'system', label: 'System audit log' },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`px-3 py-1.5 transition-colors ${
                view === v.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {view === 'activity' ? <EmployeeActivityView /> : <SystemAuditView />}
      </div>
    </div>
  );
}
