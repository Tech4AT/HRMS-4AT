'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { onboardingApi, type OnboardingRecordListItem } from '@/lib/api/onboarding';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

function isUpcoming(r: OnboardingRecordListItem): boolean {
  if (r.stage === 'completed') return false;
  const today = new Date().toISOString().slice(0, 10);
  return r.joiningDate >= today;
}

/** Day-one joiners, live from onboarding records: upcoming vs recently
 * completed. Every name shown is a real record — never sample data. */
export default function NewJoinersPage() {
  const [rows, setRows] = useState<OnboardingRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [group, setGroup] = useState<'Upcoming' | 'Recent'>('Upcoming');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRows(await onboardingApi.getRecords());
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
    return rows.filter((r) => {
      if (group === 'Upcoming' ? !isUpcoming(r) : isUpcoming(r)) return false;
      if (!q) return true;
      return [r.employee.name, r.employee.employeeCode, r.employee.workEmail]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, group, search]);

  return (
    <div>
      <PageHeader title="New Joiners" />

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
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            {(['Upcoming', 'Recent'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  group === g
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code or email…"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">{group} joiners</h3>
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
            No {group.toLowerCase()} joiners.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Joiner', 'Joining date', 'Progress', 'Stage'].map((h) => (
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
                    <td className="px-5 py-3 text-sm text-slate-700">{r.joiningDate}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {r.progress.total === 0
                        ? '—'
                        : `${r.progress.completed}/${r.progress.total} (${r.progress.percent}%)`}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill value={r.stage === 'completed' ? 'Completed' : 'Pending'} />
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
