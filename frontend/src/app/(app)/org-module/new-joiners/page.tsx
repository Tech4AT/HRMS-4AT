'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { newJoiners } from '@/lib/mock/org/phase3';
import { PageHeader, StatusPill, StubModal } from '@/components/org-module/ui';

export default function NewJoinersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');
  const [group, setGroup] = useState<'Upcoming' | 'Recent'>('Upcoming');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return newJoiners.filter((j) => {
      if (j.group !== group) return false;
      if (!q) return true;
      return [j.name, j.position, j.department, j.buddy, j.manager].join(' ').toLowerCase().includes(q);
    });
  }, [group, search]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="New Joiners"
          subtitle="Day-one joiners moving into onboarding (mock data, stub actions)."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Add joiner
          </button>
        ) : null}
      </div>

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
                {g} ({newJoiners.filter((j) => j.group === g).length})
              </button>
            ))}
          </div>
          <div className="min-w-[200px] flex-1 max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, position, buddy…"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">{group} joiners</h3>
          <span className="text-xs text-slate-500">
            Showing {visible.length} of {newJoiners.filter((j) => j.group === group).length}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No joiners match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Joiner', 'Start date', 'Position', 'Org assignment', 'Buddy', 'Manager', 'Readiness'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{j.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{j.doj}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{j.position}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {j.department} · {j.location}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{j.buddy}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{j.manager}</td>
                    <td className="px-5 py-3">
                      <StatusPill value={j.readiness} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd ? (
        <StubModal
          title="Add joiner"
          fields={[
            { name: 'name', label: 'Joiner name', placeholder: 'e.g. Farhan Qureshi' },
            { name: 'doj', label: 'Start date', placeholder: 'YYYY-MM-DD' },
            { name: 'buddy', label: 'Buddy', placeholder: 'e.g. Kiran Shah' },
            { name: 'manager', label: 'Manager', placeholder: 'e.g. Arjun Mehta' },
          ]}
          onClose={() => setShowAdd(false)}
        />
      ) : null}
    </div>
  );
}
