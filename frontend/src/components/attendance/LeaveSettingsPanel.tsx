'use client';

import { useEffect, useState } from 'react';
import { leaveApi, LeaveApiError, type LeaveType, type LeaveTypeInput } from '@/lib/api/leave';
import { LeaveBalancesPanel } from '@/components/attendance/LeaveBalancesPanel';
import { LeaveTypeDialog, usageOf, type LeaveTypeDialogKind } from '@/components/attendance/LeaveTypeDialogs';

const CATEGORY_OPTIONS = ['Regular', 'Compensatory offs', 'Unpaid', 'Incident based'];

const EMPTY_DRAFT: LeaveTypeInput = {
  name: '',
  category: 'Regular',
  annual_allocation: 0,
  carry_forward_limit: 0,
  requires_approval: true,
  is_paid: true,
  description: '',
};

function LeaveTypeForm({
  title,
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
}: {
  title: string;
  draft: LeaveTypeInput;
  onChange: (next: LeaveTypeInput) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder="e.g. Sick Leave"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
            <select
              value={draft.category}
              onChange={(e) => onChange({ ...draft, category: e.target.value })}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Annual allocation (days)</label>
              <input
                type="number"
                min={0}
                value={draft.annual_allocation}
                onChange={(e) => onChange({ ...draft, annual_allocation: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Carry-forward limit</label>
              <input
                type="number"
                min={0}
                value={draft.carry_forward_limit}
                onChange={(e) => onChange({ ...draft, carry_forward_limit: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
              />
            </div>
          </div>

          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.is_paid}
                onChange={(e) => onChange({ ...draft, is_paid: e.target.checked })}
                className="rounded border-slate-300"
              />
              Paid
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.requires_approval}
                onChange={(e) => onChange({ ...draft, requires_approval: e.target.checked })}
                className="rounded border-slate-300"
              />
              Requires approval
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              value={draft.description}
              onChange={(e) => onChange({ ...draft, description: e.target.value })}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center gap-2 p-4 border-t border-slate-200">
          <button
            onClick={onSave}
            disabled={saving || !draft.name.trim()}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings > Leave Settings. Leave types are real data (shared with Leave
 *  Management and Approvals via `leaveApi`), backed by the in-memory mock
 *  backend for now - see lib/api/mock-data.ts. Lets HR add new leave types
 *  and edit or remove existing ones; no leave-type code is asked for, it's
 *  derived automatically. */
export function LeaveSettingsPanel() {
  const [view, setView] = useState<'types' | 'balances'>('types');
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<LeaveTypeInput>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LeaveTypeInput>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: LeaveTypeDialogKind; typeId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // `silent` reloads the list without flashing the loading state, for refreshing
  // usage counts under an open dialog.
  const refresh = (silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    leaveApi
      .getTypes()
      .then(setTypes)
      .catch((e) => {
        if (!silent) setLoadError(e instanceof Error ? e.message : 'Failed to load leave types');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => refresh(), []);

  const filtered = types.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  const startAdd = () => {
    setAddDraft(EMPTY_DRAFT);
    setFormError(null);
    setAdding(true);
  };

  const saveAdd = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await leaveApi.createType(addDraft);
      setAdding(false);
      refresh();
    } catch (e) {
      setFormError(e instanceof LeaveApiError ? e.message : 'Could not create this leave type');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (t: LeaveType) => {
    setEditingId(t.id);
    setEditDraft({
      name: t.name,
      category: t.category,
      annual_allocation: t.annual_allocation,
      carry_forward_limit: t.carry_forward_limit,
      requires_approval: t.requires_approval,
      is_paid: t.is_paid,
      description: t.description ?? '',
    });
    setFormError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setFormError(null);
    try {
      await leaveApi.updateType(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e) {
      setFormError(e instanceof LeaveApiError ? e.message : 'Could not update this leave type');
    } finally {
      setSaving(false);
    }
  };

  // Delete what is unused; for a type with history explain why it can't be
  // deleted and offer to deactivate it instead.
  const openDelete = (t: LeaveType) => {
    setNotice(null);
    setActionError(null);
    setDialog({ kind: usageOf(t).inUse ? 'blocked' : 'delete', typeId: t.id });
  };

  const openDeactivate = (t: LeaveType) => {
    setNotice(null);
    setActionError(null);
    setDialog({ kind: 'deactivate', typeId: t.id });
  };

  const reactivate = async (t: LeaveType) => {
    setNotice(null);
    setActionError(null);
    setBusyId(t.id);
    try {
      await leaveApi.setTypeStatus(t.id, 'active');
      setNotice(`Reactivated “${t.name}”. It can be used for new leave requests again.`);
      refresh(true);
    } catch (e) {
      setActionError(e instanceof LeaveApiError ? e.message : 'Could not reactivate this leave type');
    } finally {
      setBusyId(null);
    }
  };

  const dialogType = dialog ? types.find((t) => t.id === dialog.typeId) : undefined;

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white">
        <button
          onClick={() => setView('types')}
          className={`px-4 py-2 text-sm font-semibold transition-colors ${
            view === 'types' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Leave Types
        </button>
        <button
          onClick={() => setView('balances')}
          className={`px-4 py-2 text-sm font-semibold border-l border-slate-200 transition-colors ${
            view === 'balances' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Leave Balances
        </button>
      </div>

      {view === 'balances' ? (
        <LeaveBalancesPanel types={types.filter((t) => t.status === 'active')} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div>
              <h3 className="text-base font-bold text-slate-900">Leave types</h3>
              <p className="text-xs text-slate-500 mt-1">
                Below are the leave types used in your organisation — add a new one as you need it.
              </p>
            </div>
            <button
              onClick={startAdd}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
            >
              + Add Leave Type
            </button>
          </div>

          <div className="px-5 pb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full sm:w-72 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            />
          </div>

          {notice ? (
            <p role="status" className="mx-5 mb-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {notice}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="mx-5 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {actionError}
            </p>
          ) : null}

          {loading ? (
            <p className="px-5 pb-5 text-sm text-slate-500">Loading leave types…</p>
          ) : loadError ? (
            <p className="px-5 pb-5 text-sm text-red-600">{loadError}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    {['Name', 'Type', 'Is Paid', 'Status', 'In use', 'Actions'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 text-sm font-medium text-slate-900 whitespace-nowrap">{t.name}</td>
                      <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{t.category}</td>
                      <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{t.is_paid ? 'Paid' : 'Unpaid'}</td>
                      <td className="px-5 py-4 text-sm whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {t.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                        {usageOf(t).inUse
                          ? `${usageOf(t).balances} balance${usageOf(t).balances === 1 ? '' : 's'} · ${usageOf(t).requests} request${usageOf(t).requests === 1 ? '' : 's'}`
                          : 'Not used'}
                      </td>
                      <td className="px-5 py-4 text-sm whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <button onClick={() => startEdit(t)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                            Edit
                          </button>
                          {t.status === 'active' ? (
                            <button
                              onClick={() => openDeactivate(t)}
                              className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => reactivate(t)}
                              disabled={busyId === t.id}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                            >
                              {busyId === t.id ? 'Reactivating…' : 'Reactivate'}
                            </button>
                          )}
                          <button
                            onClick={() => openDelete(t)}
                            className="text-xs font-semibold text-red-500 hover:text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                        {types.length === 0 ? 'No leave types yet.' : 'No leave types match your search.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {adding ? (
            <LeaveTypeForm
              title="Add Leave Type"
              draft={addDraft}
              onChange={setAddDraft}
              onCancel={() => setAdding(false)}
              onSave={saveAdd}
              saving={saving}
              error={formError}
            />
          ) : null}

          {editingId ? (
            <LeaveTypeForm
              title="Edit Leave Type"
              draft={editDraft}
              onChange={setEditDraft}
              onCancel={() => setEditingId(null)}
              onSave={saveEdit}
              saving={saving}
              error={formError}
            />
          ) : null}

          {dialog && dialogType ? (
            <LeaveTypeDialog
              key={`${dialog.kind}-${dialog.typeId}`}
              kind={dialog.kind}
              type={dialogType}
              onSwitch={(kind) => {
                // Usage may have changed since the list loaded; recount before explaining.
                if (kind === 'blocked') refresh(true);
                setDialog({ kind, typeId: dialog.typeId });
              }}
              onClose={() => setDialog(null)}
              onDone={(message) => {
                setDialog(null);
                setNotice(message);
                refresh(true);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
