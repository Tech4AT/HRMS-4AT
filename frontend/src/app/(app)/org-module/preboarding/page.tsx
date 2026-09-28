'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { onboardingApi, type OnboardingRecordListItem } from '@/lib/api/onboarding';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

/** Candidates between offer and day one, live from onboarding records in the
 * preboarding stage. Every name shown is a real record — never sample data. */
export default function PreboardingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<OnboardingRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRows(await onboardingApi.getRecords('preboarding'));
    } catch {
      setRows([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.employee.name, r.employee.employeeCode, r.employee.workEmail]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  void canManage;

  return (
    <div>
      <PageHeader
        title="Preboarding"
        subtitle="Candidates between offer and day one (live onboarding records; new candidates are added through the onboarding module)."
      />

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">Couldn&apos;t reach the onboarding records.</p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code or email…"
          className="w-full max-w-md px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Candidates</h3>
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
            {rows.length === 0 ? 'No candidates in preboarding.' : 'No candidates match.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Candidate', 'Code', 'Joining date', 'Readiness', 'Stage'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-slate-900">{r.employee.name}</p>
                      <p className="text-xs text-slate-500">{r.employee.workEmail}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{r.employee.employeeCode}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{r.joiningDate}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {r.progress.total === 0
                        ? '—'
                        : `${r.progress.completed}/${r.progress.total} tasks (${r.progress.percent}%)`}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill value={r.stage === 'preboarding' ? 'Pending' : 'Active'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
