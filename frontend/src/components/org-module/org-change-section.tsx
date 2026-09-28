'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import {
  orgChangesApi,
  type OrgChange,
  type OrgChangeStatus,
  type OrgChangeType,
} from '@/lib/api/orgchanges';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

const STATUS_LABEL: Record<OrgChangeStatus, string> = {
  pending: 'Pending',
  effective: 'Effective',
  cancelled: 'Cancelled',
};

export interface IdOption {
  id: string;
  name: string;
}

interface OrgChangeSectionProps {
  changeType: OrgChangeType;
  title: string;
  subtitle: string;
  logLabel: string;
  /** Payload key carrying the "to" id, e.g. department_id. */
  toField: string;
  toLabel: string;
  /** Candidate "to" targets for the log form. */
  toOptions: IdOption[];
  /** Current assignment id of an employee (for the "from" side); null when unknown. */
  currentValue: (e: OrgEmployee) => string | null;
  /** Resolve any id appearing in from/to data to a display name. */
  resolveName: (id: string) => string;
}

function displayValue(data: Record<string, unknown>, resolveName: (id: string) => string): string {
  const named = data?.name ?? data?.title;
  if (typeof named === 'string' && named.trim()) return named;
  for (const v of Object.values(data ?? {})) {
    if (typeof v === 'string' && v.trim()) return resolveName(v);
  }
  return '—';
}

export function OrgChangeSection({
  changeType,
  title,
  subtitle,
  logLabel,
  toField,
  toLabel,
  toOptions,
  currentValue,
  resolveName,
}: OrgChangeSectionProps) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<OrgChange[]>([]);
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrgChangeStatus | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [logEmployee, setLogEmployee] = useState('');
  const [logTo, setLogTo] = useState('');
  const [logDate, setLogDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setActionError(null);
    try {
      const [chs, directory] = await Promise.all([
        orgChangesApi.list({ change_type: changeType }),
        orgApi.listDirectory(),
      ]);
      setRows(chs);
      setEmployees(directory);
    } catch {
      setRows([]);
      setEmployees([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [changeType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, fullName(e));
    return m;
  }, [employees]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (fromDate && c.effective_date < fromDate) return false;
      if (toDate && c.effective_date > toDate) return false;
      if (!q) return true;
      const hay = [names.get(c.employee_id) ?? '', c.effective_date].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, statusFilter, fromDate, toDate, search, names]);

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    if (!logEmployee || !logTo || !logDate) {
      setFormError('Employee, target and effective date are all required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const emp = employees.find((x) => x.id === logEmployee);
      const fromId = emp ? currentValue(emp) : null;
      await orgChangesApi.create({
        employee_id: logEmployee,
        change_type: changeType,
        from_data: fromId ? { id: fromId } : {},
        to_data: { [toField]: logTo },
        effective_date: logDate,
      });
      setShowLog(false);
      setLogEmployee('');
      setLogTo('');
      setLogDate('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not log this change.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelRow(id: string) {
    setActionError(null);
    try {
      await orgChangesApi.cancel(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel this change.');
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title={title} subtitle={subtitle} />
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowLog(true)}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {logLabel}
          </button>
        ) : null}
      </div>

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">Couldn&apos;t reach the org-changes log.</p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          {actionError}
        </p>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by employee…"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrgChangeStatus | '')}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            >
              <option value="">All</option>
              {(Object.keys(STATUS_LABEL) as OrgChangeStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Effective from
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Effective to
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : `Showing ${visible.length} of ${rows.length}`}
          </span>
        </div>
        {loading ? (
          <div className="p-5 space-y-2 animate-pulse">
            <div className="h-10 bg-slate-50 rounded-xl" />
            <div className="h-10 bg-slate-50 rounded-xl" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            {rows.length === 0 ? 'No records yet.' : 'No records match.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Employee', 'From', 'To', 'Effective date', 'Status', 'Recorded'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                  {canManage ? (
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                      {names.get(c.employee_id) ?? 'Unknown employee'}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {displayValue(c.from_data, resolveName)}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {displayValue(c.to_data, resolveName)}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.effective_date}</td>
                    <td className="px-5 py-3">
                      <StatusPill value={STATUS_LABEL[c.status]} />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {c.updated_at ? c.updated_at.slice(0, 10) : '—'}
                    </td>
                    {canManage ? (
                      <td className="px-5 py-3 text-sm">
                        {c.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => cancelRow(c.id)}
                            className="text-xs font-semibold text-rose-700 hover:text-rose-800"
                          >
                            Cancel
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowLog(false)}
          role="dialog"
          aria-modal="true"
          aria-label={logLabel}
        >
          <form
            onSubmit={submitLog}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
          >
            <h3 className="text-sm font-bold text-slate-900">{logLabel}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Saved to the org-changes log.</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">Employee</span>
                <select
                  value={logEmployee}
                  onChange={(e) => setLogEmployee(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                >
                  <option value="">Select…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {fullName(e)} ({e.employee_code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">{toLabel}</span>
                <select
                  value={logTo}
                  onChange={(e) => setLogTo(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                >
                  <option value="">Select…</option>
                  {toOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">Effective date</span>
                <input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                />
              </label>
              {formError ? <p className="text-xs text-rose-700">{formError}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLog(false)}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
