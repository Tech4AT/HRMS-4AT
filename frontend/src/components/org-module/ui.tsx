'use client';

import { useMemo, useState, type ReactNode } from 'react';

/* ------------------------------ page header ------------------------------ */

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

/* ------------------------------ stub page ------------------------------ */

export function StubPage({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={description} />
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center">
        <p className="text-sm font-semibold text-slate-900">Coming soon</p>
        <p className="text-sm text-slate-500 mt-1">
          The {title} screen is planned for a later phase. Mock actions here are stubs.
        </p>
        {bullets && bullets.length > 0 ? (
          <ul className="mt-4 inline-block text-left text-sm text-slate-600 space-y-1 list-disc list-inside">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------ stub modal ------------------------------ */

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'select';
  options?: string[];
  placeholder?: string;
}

export function StubModal({
  title,
  fields,
  initial,
  onClose,
}: {
  title: string;
  fields: FieldDef[];
  initial?: Record<string, string>;
  onClose: () => void;
}) {
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
        <p className="text-xs text-slate-500 mt-0.5">Stub form — submitting only logs, nothing is saved.</p>
        <div className="mt-4 space-y-3">
          {fields.map((f) => (
            <label key={f.name} className="block text-xs font-medium text-slate-600">
              {f.label}
              {f.type === 'select' ? (
                <select
                  defaultValue={initial?.[f.name] ?? ''}
                  aria-label={f.label}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
                >
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  defaultValue={initial?.[f.name] ?? ''}
                  placeholder={f.placeholder ?? ''}
                  aria-label={f.label}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
                />
              )}
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.log(`[org-module stub] ${title} submitted (no persistence)`);
              onClose();
            }}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ master table ------------------------------ */

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

interface ModalState<T> {
  mode: 'add' | 'edit' | 'deactivate';
  row?: T;
}

/**
 * Search/filter bar + data table + Add/Edit/Set-Inactive stub actions,
 * shared by the five Org Structure master screens.
 */
export function MasterTable<T extends { id: string }>({
  title,
  subtitle,
  columns,
  rows,
  fields,
  addLabel,
  canManage,
  searchPlaceholder = 'Search…',
}: {
  title: string;
  subtitle: string;
  columns: Column<T>[];
  rows: T[];
  fields: FieldDef[];
  addLabel: string;
  canManage: boolean;
  searchPlaceholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<ModalState<T> | null>(null);

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

  const cell = (row: T, col: Column<T>): ReactNode => {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    return <span className="text-sm text-slate-700">{String(v ?? '—')}</span>;
  };

  const modalTitle =
    modal?.mode === 'add'
      ? addLabel
      : modal?.mode === 'edit'
        ? `Edit ${title.slice(0, -1) || title}`
        : `Set ${title.slice(0, -1) || title} inactive`;

  return (
    <div>
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

      {modal ? (
        <StubModal
          title={modalTitle}
          fields={fields}
          initial={modal.row as Record<string, string> | undefined}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ status pill ------------------------------ */

const pillStyles: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  Inactive: 'bg-slate-100 text-slate-600',
  Completed: 'bg-emerald-100 text-emerald-700',
  Pending: 'bg-amber-100 text-amber-700',
  Scheduled: 'bg-sky-100 text-sky-700',
  Filled: 'bg-emerald-100 text-emerald-700',
  Vacant: 'bg-rose-100 text-rose-700',
  Hiring: 'bg-indigo-100 text-indigo-700',
  'On Hold': 'bg-amber-100 text-amber-700',
};

export function StatusPill({ value }: { value: string }) {
  return (
    <span
      className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${pillStyles[value] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {value}
    </span>
  );
}
