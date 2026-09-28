'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { onboardingProgress, type ChecklistStatus } from '@/lib/mock/org/phase3';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${value}%` }} />
    </div>
  );
}

function taskStyle(status: ChecklistStatus): string {
  if (status === 'Done') return 'bg-emerald-100 text-emerald-700';
  if (status === 'In Progress') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

export default function OnboardingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Onboarding"
          subtitle="New-joiner progress against templates and checklists (mock data, stub actions)."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.log('[org-module stub] Assign template submitted (no persistence)');
            }}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Assign template
          </button>
        ) : null}
      </div>

      <div className="space-y-4">
        {onboardingProgress.map((o) => (
          <div key={o.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{o.joiner}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{o.template}</p>
                </div>
                <span className="text-xs font-semibold text-slate-700">{o.progress}% complete</span>
              </div>
              <div className="mt-3">
                <ProgressBar value={o.progress} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Task', 'Owner', 'Due', 'Status'].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {o.tasks.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-2.5 text-sm text-slate-700">{t.task}</td>
                      <td className="px-5 py-2.5 text-sm text-slate-700">{t.owner}</td>
                      <td className="px-5 py-2.5 text-sm text-slate-700">{t.due}</td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${taskStyle(t.status)}`}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Overall status: <StatusPill value="In Progress" /> {onboardingProgress.length} joiners on
        templates.
      </p>
    </div>
  );
}
