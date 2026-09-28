'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from './ui';
import { OrgApiError } from '@/lib/api/org';

/* ------------------------------ field defs ------------------------------ */

export interface ManageFieldOption {
  value: string;
  label: string;
}

export interface ManageField {
  name: string;
  label: string;
  type?: 'text' | 'select';
  /** Plain strings render as-is; {value,label} pairs submit the value. */
  options?: (string | ManageFieldOption)[];
  placeholder?: string;
}

export interface ManageColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

function optionValue(o: string | ManageFieldOption): string {
  return typeof o === 'string' ? o : o.value;
}

function optionLabel(o: string | ManageFieldOption): string {
  return typeof o === 'string' ? o : o.label;
}

/** Initial form value for a field: prefers a `<name>Id` raw id on the row. */
function initialFor(row: Record<string, unknown> | undefined, name: string): string {
  if (!row) return '';
  const raw = row[`${name}Id`] ?? row[name];
  return raw === null || raw === undefined ? '' : String(raw);
}

/* ------------------------------ form modal ------------------------------ */

export function ManageModal({
  title,
  fields,
  initial,
  saving,
  error,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: ManageField[];
  initial?: Record<string, unknown>;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.name] = initialFor(initial, f.name);
    return seed;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {error ? (
          <p className="mt-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}
        <div className="mt-4 space-y-3">
          {fields.map((f) => (
            <label key={f.name} className="block text-xs font-medium text-slate-600">
              {f.label}
              {f.type === 'select' ? (
                <select
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  aria-label={f.label}
                  disabled={saving}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 disabled:opacity-60"
                >
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={optionValue(o)} value={optionValue(o)}>
                      {optionLabel(o)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  placeholder={f.placeholder ?? ''}
                  aria-label={f.label}
                  disabled={saving}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 disabled:opacity-60"
                />
              )}
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(values)}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ manage table ------------------------------ */

interface ModalState<T> {
  mode: 'add' | 'edit' | 'deactivate';
  row?: T;
}

/**
 * Search/filter bar + data table + REAL Add/Edit/Set-Inactive actions.
 * The parent owns the data and performs the mutations; this component owns
 * the modal, the saving state, and error display. Closes the modal only
 * when the mutation promise resolves.
 */
export function ManageTable<T extends { id: string }>({
  title,
  subtitle,
  columns,
  rows,
  fields,
  addLabel,
  canManage,
  searchPlaceholder = 'Search…',
  loading = false,
  loadFailed = false,
  onRetry,
  onAdd,
  onEdit,
  onDeactivate,
}: {
  title: string;
  subtitle: string;
  columns: ManageColumn<T>[];
  rows: T[];
  fields: ManageField[];
  addLabel: string;
  canManage: boolean;
  searchPlaceholder?: string;
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  onAdd: (values: Record<string, string>) => Promise<void>;
  onEdit: (row: T, values: Record<string, string>) => Promise<void>;
  onDeactivate: (row: T) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<ModalState<T> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasStatus = rows.some((r) => 'status' in r);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && (r as Record<string, unknown>).status !== statusFilter) return false;
      if (!q) return true;
      return Object.values(r as Record<string, unknown>)
        .map((v) => String(v ?? ''))
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, statusFilter]);

  const cell = (row: T, col: ManageColumn<T>): ReactNode => {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    return <span className="text-sm text-slate-700">{String(v ?? '—')}</span>;
  };

  const close = () => {
    if (!saving) {
      setModal(null);
      setFormError(null);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setFormError(null);
    try {
      await fn();
      setModal(null);
    } catch (e) {
      setFormError(e instanceof OrgApiError ? e.message : 'Something went wrong. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const singular = title.endsWith('s') ? title.slice(0, -1) : title;
  const modalTitle =
    modal?.mode === 'add' ? addLabel : modal?.mode === 'edit' ? `Edit ${singular}` : `Set ${singular} inactive`;

  if (loading) {
    return (
      <div>
        <PageHeader title={title} subtitle="Loading…" />
        <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
          <div className="h-4 w-1/3 bg-slate-100 rounded" />
          <div className="mt-3 space-y-2">
            <div className="h-8 bg-slate-50 rounded" />
            <div className="h-8 bg-slate-50 rounded" />
            <div className="h-8 bg-slate-50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">Couldn&apos;t reach the server — showing no records.</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title={title} subtitle={subtitle} />
        {canManage ? (
          <button
            type="button"
            onClick={() => setModal({ mode: 'add' })}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {addLabel}
          </button>
        ) : null}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          {hasStatus ? (
            <div className="min-w-[150px]">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <span className="text-xs text-slate-500">
            Showing {visible.length} of {rows.length}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No records match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {c.label}
                    </th>
                  ))}
                  {canManage ? (
                    <th className="px-5 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    {columns.map((c) => (
                      <td key={c.key} className="px-5 py-3">
                        {cell(row, c)}
                      </td>
                    ))}
                    {canManage ? (
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setModal({ mode: 'edit', row })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setModal({ mode: 'deactivate', row })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Set Inactive
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.mode === 'deactivate' && modal.row ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
        >
          <div
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-900">{modalTitle}</h3>
            <p className="mt-2 text-sm text-slate-600">
              This hides it from pickers but keeps its history. Continue?
            </p>
            {formError ? (
              <p className="mt-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {formError}
              </p>
            ) : null}
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={close}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => run(() => onDeactivate(modal.row as T))}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Set Inactive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal && modal.mode !== 'deactivate' ? (
        <ManageModal
          key={`${modal.mode}-${modal.row?.id ?? 'new'}`}
          title={modalTitle}
          fields={fields}
          initial={modal.row as unknown as Record<string, unknown> | undefined}
          saving={saving}
          error={formError}
          submitLabel={modal.mode === 'add' ? 'Add' : 'Save'}
          onClose={close}
          onSubmit={(values) =>
            run(() => (modal.mode === 'add' ? onAdd(values) : onEdit(modal.row as T, values)))
          }
        />
      ) : null}
    </div>
  );
}
