'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import {
  onboardingApi,
  type OnboardingTemplate,
  type TaskCategory,
  type TaskOwner,
} from '@/lib/api/onboarding';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

const CATEGORIES: TaskCategory[] = ['preboarding', 'onboarding'];
const OWNERS: TaskOwner[] = ['new_hire', 'hr_admin', 'manager', 'buddy', 'it_admin'];

/** Reusable onboarding checklist templates, live from the template registry.
 * Add and deactivate save through the real endpoints. */
export default function OnboardingTasksPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<OnboardingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('onboarding');
  const [owner, setOwner] = useState<TaskOwner>('hr_admin');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRows(await onboardingApi.getTemplates());
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

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Template title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onboardingApi.createTemplate({ category, title: title.trim(), owner });
      setShowAdd(false);
      setTitle('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the template.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setError(null);
    try {
      await onboardingApi.deactivateTemplate(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate the template.');
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Tasks / Templates"
          subtitle="Reusable onboarding checklists live from the template registry."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Add template
          </button>
        ) : null}
      </div>

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">Couldn&apos;t reach the template registry.</p>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Templates</h3>
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : `Showing ${rows.length} templates`}
          </span>
        </div>
        {loading ? (
          <div className="p-5 space-y-2 animate-pulse">
            <div className="h-10 bg-slate-50 rounded-xl" />
            <div className="h-10 bg-slate-50 rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No templates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Template', 'Category', 'Owner', 'Due offset', 'Status'].map((h) => (
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
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                      {t.description ? (
                        <p className="text-xs text-slate-500">{t.description}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill value={t.category === 'preboarding' ? 'Pending' : 'Active'} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{t.owner}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">Day {t.offsetDays}</td>
                    <td className="px-5 py-3">
                      <StatusPill value={t.isActive ? 'Active' : 'Inactive'} />
                    </td>
                    {canManage ? (
                      <td className="px-5 py-3 text-sm">
                        {t.isActive ? (
                          <button
                            type="button"
                            onClick={() => deactivate(t.id)}
                            className="text-xs font-semibold text-rose-700 hover:text-rose-800"
                          >
                            Deactivate
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

      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowAdd(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add template"
        >
          <form
            onSubmit={submitAdd}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
          >
            <h3 className="text-sm font-bold text-slate-900">Add template</h3>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">Template name</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Day-one HR checklist"
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TaskCategory)}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600">Owner</span>
                <select
                  value={owner}
                  onChange={(e) => setOwner(e.target.value as TaskOwner)}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                >
                  {OWNERS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
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
