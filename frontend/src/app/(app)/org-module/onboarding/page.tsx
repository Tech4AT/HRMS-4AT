'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import {
  onboardingApi,
  type OnboardingRecord,
  type TaskStatus,
} from '@/lib/api/onboarding';
import { PageHeader } from '@/components/org-module/ui';

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${value}%` }} />
    </div>
  );
}

function taskStyle(status: TaskStatus): string {
  if (status === 'done') return 'bg-emerald-100 text-emerald-700';
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

const TASK_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
  skipped: 'Skipped',
};

const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  pending: 'in_progress',
  in_progress: 'done',
};

/** Onboarding progress per joiner, live from onboarding records with their
 * tasks. Task advance and record completion save through the real endpoints. */
export default function OnboardingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const list = await onboardingApi.getRecords('onboarding');
      const details = await Promise.all(list.map((r) => onboardingApi.getRecord(r.id)));
      setRecords(details);
    } catch {
      setRecords([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function advanceTask(taskId: number, status: TaskStatus) {
    const next = NEXT_STATUS[status];
    if (!next) return;
    setBusy(`task-${taskId}`);
    setError(null);
    try {
      await onboardingApi.setTaskStatus(taskId, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task.');
    } finally {
      setBusy(null);
    }
  }

  async function completeRecord(id: number) {
    setBusy(`record-${id}`);
    setError(null);
    try {
      await onboardingApi.complete(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete onboarding.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Onboarding" />
      </div>

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

      {error ? (
        <p className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-40 bg-white border border-slate-200 rounded-xl" />
          <div className="h-40 bg-white border border-slate-200 rounded-xl" />
        </div>
      ) : records.length === 0 && !loadFailed ? (
        <p className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-500">
          Nobody is in onboarding right now.
        </p>
      ) : (
        <div className="space-y-4">
          {records.map((o) => (
            <div key={o.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{o.employee.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {o.employee.employeeCode} · joining {o.joiningDate}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-700">
                      {o.progress.percent}% complete
                    </span>
                    {canManage && !o.completedAt ? (
                      <button
                        type="button"
                        disabled={busy === `record-${o.id}`}
                        onClick={() => completeRecord(o.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
                      >
                        {busy === `record-${o.id}` ? 'Completing…' : 'Complete'}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  <ProgressBar value={o.progress.percent} />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Task', 'Owner', 'Due', 'Status', canManage ? 'Advance' : ''].map((h, i) => (
                        <th
                          key={`${h}-${i}`}
                          className="px-5 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {o.tasks.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-500">
                          No tasks on this record yet.
                        </td>
                      </tr>
                    ) : (
                      o.tasks.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-2.5 text-sm text-slate-700">{t.title}</td>
                          <td className="px-5 py-2.5 text-sm text-slate-700">
                            {t.assignee?.name ?? t.owner}
                          </td>
                          <td className="px-5 py-2.5 text-sm text-slate-700">{t.dueDate ?? '—'}</td>
                          <td className="px-5 py-2.5">
                            <span
                              className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${taskStyle(t.status)}`}
                            >
                              {TASK_LABEL[t.status]}
                            </span>
                          </td>
                          {canManage ? (
                            <td className="px-5 py-2.5">
                              {NEXT_STATUS[t.status] ? (
                                <button
                                  type="button"
                                  disabled={busy === `task-${t.id}`}
                                  onClick={() => advanceTask(t.id, t.status)}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-60"
                                >
                                  {busy === `task-${t.id}`
                                    ? 'Saving…'
                                    : `Mark ${TASK_LABEL[NEXT_STATUS[t.status]!]}`}
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
