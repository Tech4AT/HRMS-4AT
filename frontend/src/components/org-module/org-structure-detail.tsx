'use client';

/**
 * Detail panel + add/edit drawer for the unified Org Structure screen.
 *
 * RULE: every stored column is editable and saved (name/code/description on
 * every master, plus the per-kind `extraFields` spec in
 * org-structure-types.ts). Keka-only fields with no backend column render
 * visibly DISABLED with a "not stored yet" hint — never collected-and-dropped,
 * never fake-saved. The drawer and the detail panel both render from the same
 * `extraFields` spec, so they cannot drift apart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrgEmployee } from '@/lib/api/org';
import {
  adminAddEmployees,
  adminCreate,
  adminDelete,
  adminListFiltered,
  adminUpdate,
  camelKey,
  configFor,
  fullName,
  initials,
  membersOf,
  OrgAdminError,
  type AdminWriteInput,
  type ExtraField,
  type FkTarget,
  type TypeConfig,
  type UnitItem,
  type UnitKind,
} from './org-structure-types';

export type FkOptions = Record<FkTarget, { id: string; name: string }[]>;

export const EMPTY_FK_OPTIONS: FkOptions = {
  employee: [],
  department: [],
  location: [],
  'legal-entity': [],
  'business-unit': [],
  'cost-center': [],
  'job-family': [],
  level: [],
  'job-title': [],
  'pay-grade': [],
};

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
              <td className="px-4 py-2.5 text-sm">
                {e.status === 'exited' ? (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">Exited</span>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">{e.status || 'Active'}</span>
                )}
              </td>
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

/** Raw admin value -> drawer string for one spec field. */
function adminToString(admin: Record<string, unknown> | undefined, field: ExtraField, parentId?: string | null): string {
  if (field.key === 'parent' && (admin?.['parent'] === undefined || admin?.['parent'] === null)) {
    return parentId ?? '';
  }
  const v = admin?.[camelKey(field.key)];
  if (v === null || v === undefined) return '';
  return String(v);
}

function UnitDrawer({
  kind,
  state,
  allUnits,
  fkOptions,
  canManage,
  onClose,
  onSaved,
}: {
  kind: UnitKind;
  state: Exclude<DrawerState, null>;
  allUnits: UnitItem[];
  fkOptions: FkOptions;
  canManage: boolean;
  onClose: () => void;
  onSaved: (saved: { id: string; name: string; code?: string }) => void;
}) {
  const cfg = configFor(kind);
  const editing = state.mode === 'edit' ? state.item : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [parentId, setParentId] = useState<string>(editing?.parentId ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of cfg.extraFields) {
      if (f.type === 'boolean') continue;
      init[f.key] = adminToString(editing?.admin, f, editing?.parentId);
    }
    return init;
  });
  const [booleans, setBooleans] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of cfg.extraFields) {
      if (f.type !== 'boolean') continue;
      init[f.key] = Boolean(editing?.admin?.[camelKey(f.key)]);
    }
    return init;
  });
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(editing?.name ?? '');
    setCode(editing?.code ?? '');
    setDescription(editing?.description ?? '');
    setParentId(editing?.parentId ?? '');
    const nextValues: Record<string, string> = {};
    for (const f of cfg.extraFields) {
      if (f.type === 'boolean') continue;
      nextValues[f.key] = adminToString(editing?.admin, f, editing?.parentId);
    }
    setValues(nextValues);
    const nextBooleans: Record<string, boolean> = {};
    for (const f of cfg.extraFields) {
      if (f.type !== 'boolean') continue;
      nextBooleans[f.key] = Boolean(editing?.admin?.[camelKey(f.key)]);
    }
    setBooleans(nextBooleans);
    setActive(true);
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, state.mode, editing?.id]);

  if (!canManage || !cfg.adminResource) return null;

  const setValue = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

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
      const input: AdminWriteInput = {
        name: trimmed,
        code: code.trim(),
        description: description.trim(),
      };
      if (cfg.hasParent) input.parent = parentId || null;
      for (const f of cfg.extraFields) {
        if (f.key === 'parent' && !cfg.hasParent) {
          input.parent = values[f.key] || null;
          continue;
        }
        if (f.type === 'boolean') {
          input[f.key] = booleans[f.key] ?? false;
        } else if (f.type === 'fk') {
          input[f.key] = values[f.key] || null;
        } else if (f.type === 'number') {
          const raw = (values[f.key] ?? '').trim();
          input[f.key] = raw === '' ? null : Number(raw);
          if (raw !== '' && Number.isNaN(input[f.key] as number)) {
            throw new OrgAdminError(`${f.label} must be a number.`, 400);
          }
        } else if (f.type === 'select') {
          if ((values[f.key] ?? '') !== '') input[f.key] = values[f.key];
        } else if (f.type === 'date') {
          const raw = (values[f.key] ?? '').trim();
          input[f.key] = raw === '' ? null : raw;
        } else {
          const v = values[f.key] ?? '';
          // LegalEntity.currency has no blank=True on the model: an empty
          // string 400s, while omitting the key applies the INR default. So
          // fall back to INR here instead of sending ''.
          input[f.key] = v === '' && f.key === 'currency' ? 'INR' : v;
        }
      }
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
  const labelCls = 'block text-xs font-semibold text-slate-600';

  function fkField(f: ExtraField) {
    const opts = f.key === 'parent' && !cfg.hasParent ? parentOptions : (fkOptions[f.fk as FkTarget] ?? []);
    return (
      <label key={f.key} className={labelCls}>
        {f.label}
        <select
          value={values[f.key] ?? ''}
          onChange={(e) => setValue(f.key, e.target.value)}
          aria-label={f.label}
          className={inputCls}
        >
          <option value="">None</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {f.hint ? <span className={hintCls}>{f.hint}</span> : null}
      </label>
    );
  }

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
        <p className={hintCls}>Every field below is stored. Disabled ones are not tracked yet.</p>

        <div className="mt-5 space-y-4">
          <label className={labelCls}>
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

          <label className={labelCls}>
            Code
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ENG"
              aria-label="Code"
              className={inputCls}
            />
          </label>

          <label className={labelCls}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this is for…"
              aria-label="Description"
              rows={3}
              className={inputCls}
            />
          </label>

          {cfg.hasParent ? (
            <label className={labelCls}>
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

          {cfg.extraFields.map((f) => {
            if (f.type === 'fk') return fkField(f);
            if (f.type === 'boolean') {
              return (
                <label key={f.key} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={booleans[f.key] ?? false}
                    onChange={(e) => setBooleans((p) => ({ ...p, [f.key]: e.target.checked }))}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  {f.label}
                </label>
              );
            }
            if (f.type === 'select') {
              return (
                <label key={f.key} className={labelCls}>
                  {f.label}
                  <select
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    aria-label={f.label}
                    className={inputCls}
                  >
                    <option value="">None</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {f.hint ? <span className={hintCls}>{f.hint}</span> : null}
                </label>
              );
            }
            if (f.type === 'textarea') {
              return (
                <label key={f.key} className={labelCls}>
                  {f.label}
                  <textarea
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    aria-label={f.label}
                    rows={2}
                    className={inputCls}
                  />
                  {f.hint ? <span className={hintCls}>{f.hint}</span> : null}
                </label>
              );
            }
            if (f.type === 'date') {
              return (
                <label key={f.key} className={labelCls}>
                  {f.label}
                  <input
                    type="date"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    aria-label={f.label}
                    className={inputCls}
                  />
                  {f.hint ? <span className={hintCls}>{f.hint}</span> : null}
                </label>
              );
            }
            return (
              <label key={f.key} className={labelCls}>
                {f.label}
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  aria-label={f.label}
                  className={inputCls}
                />
                {f.hint ? <span className={hintCls}>{f.hint}</span> : null}
              </label>
            );
          })}

          {cfg.disabledFields.map((f) => (
            <label key={f.label} className={labelCls}>
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

/** Stored extra value -> display string (FKs resolve to their *_name, then options). */
export function displayExtra(item: UnitItem, field: ExtraField, fkOptions: FkOptions): string {
  const admin = item.admin;
  if (field.type === 'boolean') {
    return admin?.[camelKey(field.key)] ? 'Yes' : 'No';
  }
  if (field.type === 'fk') {
    const nameKey = `${camelKey(field.key)}Name`;
    const named = admin?.[nameKey];
    if (typeof named === 'string' && named) return named;
    const raw = field.key === 'parent' ? (admin?.['parent'] ?? item.parentId) : admin?.[camelKey(field.key)];
    if (raw === null || raw === undefined || raw === '') return '—';
    const found = (fkOptions[field.fk as FkTarget] ?? []).find((o) => o.id === String(raw));
    return found?.name ?? '—';
  }
  if (field.type === 'select' && field.options) {
    const raw = admin?.[camelKey(field.key)];
    if (raw === null || raw === undefined || raw === '') return '—';
    return field.options.find((o) => o.value === String(raw))?.label ?? String(raw);
  }
  const raw = admin?.[camelKey(field.key)];
  if (raw === null || raw === undefined || raw === '') return '—';
  return String(raw);
}

export function DetailPanel({
  kind,
  item,
  employees,
  allUnits,
  fkOptions,
  canManage,
  onEdit,
  onDelete,
  onParentSaved,
  onChanged,
}: {
  kind: UnitKind;
  item: UnitItem;
  employees: OrgEmployee[];
  allUnits: UnitItem[];
  fkOptions: FkOptions;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onParentSaved: (childId: string, parentId: string | null) => void;
  /** Reload the directory after employees are (re)assigned to this unit. */
  onChanged?: () => void;
}) {
  const cfg: TypeConfig = configFor(kind);
  const members = useMemo(
    () => membersOf(employees, cfg.employeeKey, item.id, allUnits),
    [employees, cfg.employeeKey, item.id, allUnits],
  );
  const [tab, setTab] = useState<PanelTab>('summary');
  // Add-employees picker (HR only; units that actually have an employee FK).
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const canAddEmployees = canManage && !!cfg.employeeKey && !!cfg.adminResource;

  useEffect(() => {
    setTab('summary');
    setAddOpen(false);
    setPicked(new Set());
    setAssignSearch('');
    setAssignError(null);
  }, [kind, item.id]);

  const memberIds = useMemo(() => new Set(members.map((m) => String(m.id))), [members]);
  const assignable = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return employees
      .filter((e) => !memberIds.has(String(e.id)))
      .filter((e) => !q || fullName(e).toLowerCase().includes(q));
  }, [employees, memberIds, assignSearch]);

  const assignEmployees = async () => {
    if (picked.size === 0 || !cfg.adminResource) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await adminAddEmployees(cfg.adminResource, item.id, [...picked]);
      setAddOpen(false);
      setPicked(new Set());
      setAssignSearch('');
      onChanged?.();
    } catch (e) {
      setAssignError(e instanceof OrgAdminError ? e.message : 'Failed to add employees. Try again.');
    } finally {
      setAssigning(false);
    }
  };

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

  const fieldRowValue = (label: string, value: string) =>
    fieldRow(label, value === '—' ? <span className="text-slate-400">—</span> : value);

  const positionCount = typeof item.admin?.['positionCount'] === 'number' ? (item.admin['positionCount'] as number) : null;

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
              {fieldRowValue('Code', item.code || '—')}
              {fieldRow('Description', item.description ? item.description : <span className="text-slate-400">—</span>)}
              {cfg.hasParent
                ? fieldRow(
                    'Parent department',
                    item.parentName ?? <span className="text-slate-400">Top level — no parent</span>,
                  )
                : null}
              {cfg.extraFields.map((f) =>
                fieldRowValue(f.label, displayExtra(item, f, fkOptions)),
              )}
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 h-fit">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Stats</p>
              {cfg.hasEmployees ? (
                <>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{members.length}</p>
                  <p className="text-xs text-slate-500">Employees</p>
                </>
              ) : null}
              {cfg.hasParent ? (
                <>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{children.length}</p>
                  <p className="text-xs text-slate-500">Sub-departments</p>
                </>
              ) : null}
              {typeof item.childCount === 'number' && !cfg.hasParent ? (
                <>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{item.childCount}</p>
                  <p className="text-xs text-slate-500">Child units</p>
                </>
              ) : null}
              {positionCount !== null ? (
                <>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{positionCount}</p>
                  <p className="text-xs text-slate-500">Approved seats</p>
                </>
              ) : null}
              {!cfg.hasEmployees && cfg.hasParent === false && typeof item.childCount !== 'number' && positionCount === null ? (
                <p className="mt-2 text-xs text-slate-500">No linked records.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'employees' ? (
          <div className="space-y-3">
            {canAddEmployees && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setAddOpen((v) => !v)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  + Add employees
                </button>
              </div>
            )}
            {addOpen && canAddEmployees && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">Add employees to {item.name}</p>
                  <span className="text-xs text-slate-500">{picked.size} selected</span>
                </div>
                <input
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Search employees by name"
                  className="block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
                  aria-label="Search employees"
                />
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  {assignable.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">
                      {employees.length === 0 ? 'Directory unavailable.' : 'No employees to add.'}
                    </p>
                  ) : (
                    assignable.map((e) => {
                      const id = String(e.id);
                      return (
                        <label key={id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={picked.has(id)}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              })
                            }
                          />
                          <span className="text-slate-800">{fullName(e)}</span>
                          <span className="ml-auto text-xs text-slate-400">{e.employee_code || ''}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                {assignError && <p className="text-sm text-red-600">{assignError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      setPicked(new Set());
                      setAssignError(null);
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={assignEmployees}
                    disabled={assigning || picked.size === 0}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {assigning ? 'Adding…' : `Add ${picked.size || ''}`.trim()}
                  </button>
                </div>
              </div>
            )}
            <EmployeeTable rows={members} />
          </div>
        ) : null}

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
            <div className="flex items-center gap-4">
              {typeof item.admin?.['logo'] === 'string' && item.admin['logo'] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.admin['logo'] as string}
                  alt={`${item.name} logo`}
                  className="w-14 h-14 rounded-xl object-contain border border-slate-200 bg-slate-50"
                />
              ) : null}
              <div>
                <h4 className="text-sm font-bold text-slate-900">Registration Information</h4>
                <p className="text-[11px] text-slate-400">
                  Every field below is stored on the legal entity — edit via the ⋮ menu above.
                </p>
              </div>
            </div>
            <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
              {fieldRow('Entity name', item.name)}
              {fieldRowValue('Code', item.code || '—')}
              {cfg.extraFields.map((f) =>
                fieldRowValue(f.label, displayExtra(item, f, fkOptions)),
              )}
            </div>
          </div>
        ) : null}

        {tab === 'signatories' ? (
          <SignatoriesSection legalEntityId={item.id} canManage={canManage} />
        ) : null}

        {tab === 'bank' ? (
          <BankSection legalEntityId={item.id} canManage={canManage} />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------- legal-entity child collections -------------------- */
/**
 * Authorized Signatories + Bank Details inner tabs. Real CRUD against the
 * audited admin endpoints (`authorized-signatories`, `bank-details`), scoped
 * with `?legal_entity=<id>`. Reads come back camelCase, writes go out
 * snake_case — childStr() reads either spelling.
 */

type ChildRow = Record<string, unknown>;

function childStr(row: ChildRow, camel: string, snake: string): string {
  const v = row[camel] ?? row[snake];
  if (v === null || v === undefined) return '';
  return String(v);
}

const childInputCls =
  'mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';
const childLabelCls = 'block text-xs font-semibold text-slate-600';

function ChildSectionShell({
  title,
  count,
  canManage,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  count: number | null;
  canManage: boolean;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-bold text-slate-900">
          {title}
          {count !== null ? <span className="ml-2 text-xs font-semibold text-slate-400">{count}</span> : null}
        </h4>
        {canManage ? (
          <button
            type="button"
            onClick={onAdd}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {addLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SignatoriesSection({ legalEntityId, canManage }: { legalEntityId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ChildRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'add' } | { mode: 'edit'; row: ChildRow } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [dinOrPan, setDinOrPan] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminListFiltered('authorized-signatories', { legal_entity: legalEntityId }));
    } catch {
      setError('Couldn\u2019t load signatories. Try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [legalEntityId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setName('');
    setDesignation('');
    setEmail('');
    setDinOrPan('');
    setActive(true);
    setFormError(null);
    setForm({ mode: 'add' });
  }

  function openEdit(row: ChildRow) {
    setName(childStr(row, 'name', 'name'));
    setDesignation(childStr(row, 'designation', 'designation'));
    setEmail(childStr(row, 'email', 'email'));
    setDinOrPan(childStr(row, 'dinOrPan', 'din_or_pan'));
    setActive((row['isActive'] ?? row['is_active'] ?? true) as boolean);
    setFormError(null);
    setForm({ mode: 'edit', row });
  }

  async function submit() {
    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input: AdminWriteInput = {
        name: name.trim(),
        designation: designation.trim(),
        email: email.trim(),
        din_or_pan: dinOrPan.trim(),
      };
      if (form?.mode === 'add') {
        await adminCreate('authorized-signatories', { ...input, legal_entity: legalEntityId });
      } else if (form?.mode === 'edit') {
        await adminUpdate('authorized-signatories', String(form.row['id']), {
          ...input,
          is_active: active,
        });
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await adminDelete('authorized-signatories', id);
      setConfirmDeleteId(null);
      await load();
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading signatories…</p>;
  }

  return (
    <ChildSectionShell
      title="Authorized Signatories"
      count={rows?.length ?? null}
      canManage={canManage}
      addLabel="Add signatory"
      onAdd={openAdd}
    >
      {error ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-amber-800">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}
      {rows === null ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Signatories need the Organization Manager permission — ask an HR admin.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No authorized signatories yet{canManage ? ' — add the first one above.' : '.'}
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Designation', 'Email', 'DIN / PAN', 'Status', ...(canManage ? [''] : [])].map((h) => (
                  <th
                    key={h || 'actions'}
                    className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const id = String(r['id']);
                const isActive = Boolean(r['isActive'] ?? r['is_active'] ?? true);
                return (
                  <tr key={id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{childStr(r, 'name', 'name') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{childStr(r, 'designation', 'designation') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{childStr(r, 'email', 'email') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{childStr(r, 'dinOrPan', 'din_or_pan') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage ? (
                      <td className="px-4 py-2.5 text-sm text-right whitespace-nowrap">
                        {confirmDeleteId === id ? (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === id}
                              onClick={() => remove(id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-60"
                            >
                              {busyId === id ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setForm(null)}
          role="dialog"
          aria-modal="true"
          aria-label={form.mode === 'add' ? 'Add signatory' : 'Edit signatory'}
        >
          <div
            className="w-full max-w-md h-full bg-white shadow-xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">
              {form.mode === 'add' ? 'Add signatory' : 'Edit signatory'}
            </h3>
            <div className="mt-5 space-y-4">
              <label className={childLabelCls}>
                Full name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Asha Rao"
                  aria-label="Full name"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                Designation
                <input
                  type="text"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g. Partner"
                  aria-label="Designation"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. asha@example.com"
                  aria-label="Email"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                DIN / PAN
                <input
                  type="text"
                  value={dinOrPan}
                  onChange={(e) => setDinOrPan(e.target.value)}
                  placeholder="Director ID or PAN"
                  aria-label="DIN or PAN"
                  className={childInputCls}
                />
              </label>
              {form.mode === 'edit' ? (
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
              {formError ? <p className="text-xs font-medium text-rose-600">{formError}</p> : null}
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setForm(null)}
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
                {saving ? 'Saving…' : form.mode === 'add' ? 'Add' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ChildSectionShell>
  );
}

function BankSection({ legalEntityId, canManage }: { legalEntityId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ChildRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'add' } | { mode: 'edit'; row: ChildRow } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [branch, setBranch] = useState('');
  const [accountType, setAccountType] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminListFiltered('bank-details', { legal_entity: legalEntityId }));
    } catch {
      setError('Couldn\u2019t load bank details. Try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [legalEntityId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setBankName('');
    setAccountNumber('');
    setIfscCode('');
    setBranch('');
    setAccountType('');
    setActive(true);
    setFormError(null);
    setForm({ mode: 'add' });
  }

  function openEdit(row: ChildRow) {
    setBankName(childStr(row, 'bankName', 'bank_name'));
    setAccountNumber(childStr(row, 'accountNumber', 'account_number'));
    setIfscCode(childStr(row, 'ifscCode', 'ifsc_code'));
    setBranch(childStr(row, 'branch', 'branch'));
    setAccountType(childStr(row, 'accountType', 'account_type'));
    setActive((row['isActive'] ?? row['is_active'] ?? true) as boolean);
    setFormError(null);
    setForm({ mode: 'edit', row });
  }

  async function submit() {
    if (!bankName.trim() || !accountNumber.trim() || !ifscCode.trim()) {
      setFormError('Bank name, account number and IFSC code are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input: AdminWriteInput = {
        name: bankName.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
        ifsc_code: ifscCode.trim(),
        branch: branch.trim(),
      };
      if (accountType !== '') input.account_type = accountType;
      if (form?.mode === 'add') {
        await adminCreate('bank-details', { ...input, legal_entity: legalEntityId });
      } else if (form?.mode === 'edit') {
        await adminUpdate('bank-details', String(form.row['id']), {
          ...input,
          is_active: active,
        });
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await adminDelete('bank-details', id);
      setConfirmDeleteId(null);
      await load();
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading bank details…</p>;
  }

  return (
    <ChildSectionShell
      title="Bank Details"
      count={rows?.length ?? null}
      canManage={canManage}
      addLabel="Add bank account"
      onAdd={openAdd}
    >
      {error ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-amber-800">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}
      {rows === null ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Bank details need the Organization Manager permission — ask an HR admin.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No bank accounts yet{canManage ? ' — add the first one above.' : '.'}
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Bank', 'Account number', 'IFSC', 'Branch', 'Type', 'Status', ...(canManage ? [''] : [])].map((h) => (
                  <th
                    key={h || 'actions'}
                    className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const id = String(r['id']);
                const isActive = Boolean(r['isActive'] ?? r['is_active'] ?? true);
                const typeRaw = childStr(r, 'accountType', 'account_type');
                return (
                  <tr key={id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{childStr(r, 'bankName', 'bank_name') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600 font-mono">{childStr(r, 'accountNumber', 'account_number') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600 font-mono">{childStr(r, 'ifscCode', 'ifsc_code') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{childStr(r, 'branch', 'branch') || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">
                      {typeRaw === 'savings' ? 'Savings' : typeRaw === 'current' ? 'Current' : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage ? (
                      <td className="px-4 py-2.5 text-sm text-right whitespace-nowrap">
                        {confirmDeleteId === id ? (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === id}
                              onClick={() => remove(id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-60"
                            >
                              {busyId === id ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setForm(null)}
          role="dialog"
          aria-modal="true"
          aria-label={form.mode === 'add' ? 'Add bank account' : 'Edit bank account'}
        >
          <div
            className="w-full max-w-md h-full bg-white shadow-xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">
              {form.mode === 'add' ? 'Add bank account' : 'Edit bank account'}
            </h3>
            <div className="mt-5 space-y-4">
              <label className={childLabelCls}>
                Bank name
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. HDFC Bank"
                  aria-label="Bank name"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                Account number
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="e.g. 50100299998888"
                  aria-label="Account number"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                IFSC code
                <input
                  type="text"
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value)}
                  placeholder="e.g. HDFC0001234"
                  aria-label="IFSC code"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                Branch
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g. Hyderabad Main"
                  aria-label="Branch"
                  className={childInputCls}
                />
              </label>
              <label className={childLabelCls}>
                Account type
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  aria-label="Account type"
                  className={childInputCls}
                >
                  <option value="">None</option>
                  <option value="savings">Savings</option>
                  <option value="current">Current</option>
                </select>
              </label>
              {form.mode === 'edit' ? (
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
              {formError ? <p className="text-xs font-medium text-rose-600">{formError}</p> : null}
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setForm(null)}
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
                {saving ? 'Saving…' : form.mode === 'add' ? 'Add' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ChildSectionShell>
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
