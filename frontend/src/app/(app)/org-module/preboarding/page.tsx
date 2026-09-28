'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { preboardCandidates, preboardStages, type PreboardStage } from '@/lib/mock/org/phase3';
import { PageHeader, StatusPill, StubModal } from '@/components/org-module/ui';

function Readiness({ value }: { value: string }) {
  const style =
    value === 'Complete' || value === 'Clear'
      ? 'bg-emerald-100 text-emerald-700'
      : value === 'Partial' || value === 'In Progress'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${style}`}>
      {value}
    </span>
  );
}

export default function PreboardingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');
  const [stage, setStage] = useState<PreboardStage | 'All'>('All');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<PreboardStage, number>();
    for (const c of preboardCandidates) m.set(c.stage, (m.get(c.stage) ?? 0) + 1);
    return m;
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return preboardCandidates.filter((c) => {
      if (stage !== 'All' && c.stage !== stage) return false;
      if (!q) return true;
      return [c.name, c.position, c.department, c.location, c.doj].join(' ').toLowerCase().includes(q);
    });
  }, [stage, search]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Preboarding"
          subtitle="Candidates between offer and day one, by stage (mock data, stub actions)."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Add candidate
          </button>
        ) : null}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-2">
          {(['All', ...preboardStages] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                stage === s
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {s}
              {s !== 'All' ? ` (${counts.get(s) ?? 0})` : ` (${preboardCandidates.length})`}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, position, department…"
            className="w-full max-w-md px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Candidates</h3>
          <span className="text-xs text-slate-500">
            Showing {visible.length} of {preboardCandidates.length}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No candidates in this stage.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Candidate', 'DOJ', 'Position', 'Org assignment', 'Documents', 'BGV', 'Stage'].map((h) => (
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
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{c.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.doj}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.position}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {c.department} · {c.location}
                    </td>
                    <td className="px-5 py-3">
                      <Readiness value={c.docs} />
                    </td>
                    <td className="px-5 py-3">
                      <Readiness value={c.bgv} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill value={c.stage} />
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
          title="Add candidate"
          fields={[
            { name: 'name', label: 'Candidate name', placeholder: 'e.g. Ananya Rao' },
            { name: 'doj', label: 'Date of joining', placeholder: 'YYYY-MM-DD' },
            {
              name: 'position',
              label: 'Position (from masters)',
              type: 'select',
              options: ['Senior Engineer', 'Product Designer', 'Consultant', 'Finance Analyst'],
            },
            {
              name: 'department',
              label: 'Department (from masters)',
              type: 'select',
              options: ['Engineering', 'Design', 'Consulting', 'Finance', 'People'],
            },
          ]}
          onClose={() => setShowAdd(false)}
        />
      ) : null}
    </div>
  );
}
