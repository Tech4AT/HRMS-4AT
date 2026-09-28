'use client';

/**
 * Detail panel + add/edit drawer for the unified Org Structure screen.
 *
 * HARD RULE: only the fields the backend persists are editable and saved
 * (name everywhere, code for Cost Center, parent for Department). Every
 * other Keka field renders visibly DISABLED with a "not stored yet" hint —
 * never collected-and-dropped, never fake-saved.
 */

import { useEffect, useMemo, useState } from 'react';
import type { OrgEmployee } from '@/lib/api/org';
import {
  adminCreate,
  adminUpdate,
  configFor,
  fullName,
  initials,
  membersOf,
  OrgAdminError,
  type AdminWriteInput,
  type TypeConfig,
  type UnitItem,
  type UnitKind,
} from './org-structure-types';

/* ------------------------------- employee table ---------------------------- */

function EmployeeTable({ rows }: { rows: OrgEmployee[] }) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">No employees assigned yet.</p>;
  }
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {['Employee', 'Code', 'Email', 'Status'].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((e) => (
            <tr key={e.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                    {initials(fullName(e))}
                  </span>
                  <span className="text-sm font-medium text-slate-800">{fullName(e)}</span>
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm text-slate-600">{e.employee_code || '—'}</td>
              <td className="px-4 py-2.5 text-sm text-slate-600">{e.work_email || '—'}</td>
              <td className="px-4 py-2.5 text-sm text-slate-600">{e.status || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- kebab menu ------------------------------ */

function Kebab({
  onEdit,
  onDelete,
  canManage,
}: {
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return (
    <span className="relative">
      <button
        type="button"
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 text-lg leading-none transition-colors"
      >
        ⋮
      </button>
      {open ? (
        <span className="absolute right-0 top-9 z-20 w-36 bg-white border border-slate-200 rounded-xl shadow-lg py-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
          >
            Delete
          </button>
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------ add/edit drawer ---------------------------- */

export type DrawerState =
  | { mode: 'add' }
  | { mode: 'edit'; item: UnitItem }
  | null;

function UnitDrawer({
  kind,
  state,
  allUnits,
  canManage,
  onClose,
  onSaved,
}: {
  kind: UnitKind;
  state: Exclude<DrawerState, null>;
  allUnits: UnitItem[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (saved: { id: string; name: string; code?: string }) => void;
}) {
  const cfg = configFor(kind);
  const editing = state.mode === 'edit' ? state.item : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [parentId, setParentId] = useState<string>(editing?.parentId ?? '');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(editing?.name ?? '');
    setCode(editing?.code ?? '');
    setParentId(editing?.parentId ?? '');
    setActive(true);
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, state.mode, editing?.id]);

  if (!canManage || !cfg.adminResource) return null;

  const parentOptions = useMemo(
    () => allUnits.filter((u) => u.id !== editing?.id),
    [allUnits, editing?.id],
  );

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: AdminWriteInput = { name: trimmed };
      if (cfg.hasCode) input.code = code.trim();
      if (cfg.hasParent) input.parent = parentId || null;
      if (state.mode === 'edit') {
        input.is_active = active;
        const saved = await adminUpdate<{ id: number | string; name: string; code?: string }>(
          cfg.adminResource as string,
          editing!.id,
          input,
        );
        onSaved({ id: String(saved?.id ?? editing!.id), name: saved?.name ?? trimmed, code: saved?.code });
      } else {
        const saved = await adminCreate<{ id: number | string; name: string; code?: string }>(
          cfg.adminResource as string,
          input,
        );
        onSaved({ id: String(saved?.id), name: saved?.name ?? trimmed, code: saved?.code });
      }
      onClose();
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
      setSaving(false);
    }
  }

  const inputCls =
    'mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';
  const hintCls = 'mt-1 text-[11px] text-slate-400';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={state.mode === 'add' ? `Add ${cfg.singular}` : `Edit ${cfg.singular}`}
    >
      <div
        className="w-full max-w-md h-full bg-white shadow-xl p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">
          {state.mode === 'add' ? `Add ${cfg.singular}` : `Edit ${cfg.singular}`}
        </h3>
        <p className={hintCls}>Only stored fields save. The rest are shown disabled.</p>

        <div className="mt-5 space-y-4">
          <label className="block text-xs font-semibold text-slate-600">
            {cfg.singular} name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${cfg.singular} name`}
              aria-label={`${cfg.singular} name`}
              className={inputCls}
            />
          </label>

          {cfg.hasCode ? (
            <label className="block text-xs font-semibold text-slate-600">
              Code
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. CC-FIN-01"
                aria-label="Code"
                className={inputCls}
              />
            </label>
          ) : null}

          {cfg.hasParent ? (
            <label className="block text-xs font-semibold text-slate-600">
              Parent department
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                aria-label="Parent department"
                className={inputCls}
              >
                <option value="">Top level (no parent)</option>
                {parentOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Description is NOT a model field (verified in models.py) — honest disabled. */}
          <label className="block text-xs font-semibold text-slate-600">
            Description
            <textarea
              value=""
              disabled
              placeholder="Not stored yet"
              aria-label="Description (not stored yet)"
              rows={3}
              className={inputCls}
            />
            <span className={hintCls}>Not stored yet — the backend keeps names only.</span>
          </label>

          {cfg.disabledFields.map((f) => (
            <label key={f.label} className="block text-xs font-semibold text-slate-600">
              {f.label}
              <input type="text" value="" disabled placeholder="Not stored yet" aria-label={`${f.label} (not stored yet)`} className={inputCls} />
              <span className={hintCls}>{f.hint ?? 'Not stored yet.'}</span>
            </label>
          ))}

          {state.mode === 'edit' ? (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              Active (uncheck to deactivate)
            </label>
          ) : null}

          {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : state.mode === 'add' ? 'Add' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- detail panel ----------------------------- */

type PanelTab = 'summary' | 'employees' | 'settings' | 'registration' | 'signatories' | 'bank';

export function DetailPanel({
  kind,
  item,
  employees,
  allUnits,
  canManage,
  onEdit,
  onDelete,
  onParentSaved,
}: {
  kind: UnitKind;
  item: UnitItem;
  employees: OrgEmployee[];
  allUnits: UnitItem[];
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onParentSaved: (childId: string, parentId: string | null) => void;
}) {
  const cfg: TypeConfig = configFor(kind);
  const members = useMemo(
    () => membersOf(employees, cfg.employeeKey, item.id),
    [employees, cfg.employeeKey, item.id],
  );
  const [tab, setTab] = useState<PanelTab>('summary');

  useEffect(() => {
    setTab('summary');
  }, [kind, item.id]);

  const children = useMemo(
    () => (cfg.hasParent ? allUnits.filter((u) => u.parentId === item.id) : []),
    [allUnits, cfg.hasParent, item.id],
  );

  const tabs: { id: PanelTab; label: string }[] = useMemo(() => {
    if (kind === 'legal-entities') {
      return [
        { id: 'summary', label: 'Summary' },
        { id: 'registration', label: 'Registration Information' },
        { id: 'signatories', label: 'Authorized Signatories' },
        { id: 'bank', label: 'Bank Details' },
        ...(cfg.hasEmployees ? [{ id: 'employees' as PanelTab, label: `Employees (${members.length})` }] : []),
      ];
    }
    const base: { id: PanelTab; label: string }[] = [{ id: 'summary', label: 'Summary' }];
    if (cfg.hasEmployees) base.push({ id: 'employees', label: `Employees (${members.length})` });
    if (cfg.hasParent) base.push({ id: 'settings', label: 'Settings' });
    return base;
  }, [kind, cfg.hasEmployees, cfg.hasParent, members.length]);

  const fieldRow = (label: string, value: React.ReactNode) => (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{value}</div>
    </div>
  );

  const disabledHead = (
    <span className="flex items-center gap-2">
      <span className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-400">
        Select an employee…
      </span>
      <span className="text-[11px] font-medium text-slate-400">Not tracked yet</span>
    </span>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      {/* header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center shrink-0">
            {initials(item.name)}
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">{item.name}</h3>
            <p className="text-xs text-slate-500">{cfg.singular}</p>
          </div>
        </div>
        <Kebab onEdit={onEdit} onDelete={onDelete} canManage={canManage} />
      </div>

      {/* inner tabs */}
      <div className="px-5 border-b border-slate-200 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'summary' ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
            <div>
              {fieldRow(`${cfg.singular} Head`, disabledHead)}
              {fieldRow('Email Alias', <span className="text-slate-400">N/A</span>)}
              {cfg.hasCode
                ? fieldRow('Code', item.code ? item.code : <span className="text-slate-400">—</span>)
                : null}
              {cfg.hasParent
                ? fieldRow(
                    'Parent department',
                    item.parentName ?? <span className="text-slate-400">Top level — no parent</span>,
                  )
                : null}
              {fieldRow(
                'Description',
                <span className="text-slate-400">Not stored yet — the backend keeps names only.</span>,
              )}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 h-fit">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Stats</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{members.length}</p>
              <p className="text-xs text-slate-500">Employees</p>
              {cfg.hasParent ? (
                <>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{children.length}</p>
                  <p className="text-xs text-slate-500">Sub-departments</p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'employees' ? <EmployeeTable rows={members} /> : null}

        {tab === 'settings' && cfg.hasParent ? (
          <DepartmentSettings
            item={item}
            allUnits={allUnits}
            children={children}
            canManage={canManage}
            onParentSaved={onParentSaved}
          />
        ) : null}

        {tab === 'registration' ? (
          <div>
            <h4 className="text-sm font-bold text-slate-900">Entity Details</h4>
            <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
              {fieldRow('Entity name', item.name)}
              {fieldRow('Legal name', item.name)}
              {fieldRow('CIN / Registration no.', <span className="text-slate-400">—</span>)}
              {fieldRow('Date of incorporation', <span className="text-slate-400">—</span>)}
              {fieldRow('Type / Sector / Nature', <span className="text-slate-400">—</span>)}
              {fieldRow('Currency', <span className="text-slate-400">—</span>)}
              {fieldRow('Financial year', <span className="text-slate-400">—</span>)}
              {fieldRow('Registered address', <span className="text-slate-400">—</span>)}
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Only the name is stored by the backend. The rest are not tracked yet.
            </p>
          </div>
        ) : null}

        {tab === 'signatories' ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No authorized signatories — not tracked yet.
          </p>
        ) : null}

        {tab === 'bank' ? (
          <p className="py-10 text-center text-sm text-slate-500">No bank records — not tracked yet.</p>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------- department settings --------------------------- */

function DepartmentSettings({
  item,
  allUnits,
  children,
  canManage,
  onParentSaved,
}: {
  item: UnitItem;
  allUnits: UnitItem[];
  children: UnitItem[];
  canManage: boolean;
  onParentSaved: (childId: string, parentId: string | null) => void;
}) {
  const [parentId, setParentId] = useState<string>(item.parentId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setParentId(item.parentId ?? '');
    setError(null);
    setOk(false);
    setSaving(false);
  }, [item.id, item.parentId]);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await adminUpdate('departments', item.id, { parent: parentId || null });
      onParentSaved(item.id, parentId || null);
      setOk(true);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h4 className="text-sm font-bold text-slate-900">Hierarchy</h4>
        <label className="mt-2 block text-xs font-semibold text-slate-600">
          Parent department
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            disabled={!canManage}
            aria-label="Parent department"
            className="mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Top level (no parent)</option>
            {allUnits
              .filter((u) => u.id !== item.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        {canManage ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {ok ? <span className="text-xs font-medium text-emerald-600">Saved.</span> : null}
            {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
          </div>
        ) : null}
      </div>
      <div>
        <h4 className="text-sm font-bold text-slate-900">Sub-departments ({children.length})</h4>
        {children.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No sub-departments.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {children.map((c) => (
              <li
                key={c.id}
                className="px-3 py-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl"
              >
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- exports --------------------------------- */

export { UnitDrawer, Kebab };
export type { UnitKind };
