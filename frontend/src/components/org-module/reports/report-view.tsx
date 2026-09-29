'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  reportRowsToCsv,
  type ReportFilters,
  type ReportPayload,
} from '@/lib/admin/api';
import type { CostCenter, NamedEntity } from '@/lib/api/org';

export type ReportTarget =
  | { kind: 'report'; id: string }
  | { kind: 'saved'; id: number; name: string };

export interface ReportMasters {
  businessUnits: NamedEntity[];
  departments: NamedEntity[];
  locations: NamedEntity[];
  costCenters: CostCenter[];
  legalEntities: NamedEntity[];
}

const PAGE_SIZE = 20;
const EMPTY_FILTERS: ReportFilters = {};

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[150px] flex-1">
      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-t border-slate-200">
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages} · {from} to {to} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function ReportView({
  target,
  masters,
  onBack,
  onSchedule,
}: {
  target: ReportTarget;
  masters: ReportMasters;
  onBack: () => void;
  onSchedule: (title: string) => void;
}) {
  const [draft, setDraft] = useState<ReportFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ReportFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const targetKey = target.kind === 'report' ? `r:${target.id}` : `s:${target.id}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    const params: Record<string, string | undefined> = {
      business_unit: applied.business_unit || undefined,
      department: applied.department || undefined,
      location: applied.location || undefined,
      cost_center: applied.cost_center || undefined,
      legal_entity: applied.legal_entity || undefined,
      band: applied.band?.trim() || undefined,
    };
    const call =
      target.kind === 'report'
        ? adminApi.runReport(target.id, params)
        : adminApi.runSavedReport(target.id, params);
    call.then(
      (data) => {
        if (!cancelled) {
          setPayload(data);
          setLoading(false);
        }
      },
      (err: Error) => {
        if (!cancelled) {
          setError(err.message || 'Could not load this report.');
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, JSON.stringify(applied)]);

  const searched = useMemo(() => {
    const rows = payload?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [payload, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageRows = useMemo(
    () => searched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [searched, page],
  );
  const columns = payload?.columns ?? [];

  const title =
    target.kind === 'saved' ? target.name : (payload?.title ?? 'Report');
  const fileBase =
    target.kind === 'saved'
      ? target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : target.id;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
        >
          ← Reports
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 truncate">{title}</h3>
          {payload?.description && (
            <p className="text-xs text-slate-500 truncate">{payload.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSchedule(title)}
          className="px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Schedule
        </button>
        <button
          type="button"
          disabled={!payload || searched.length === 0}
          onClick={() =>
            payload &&
            downloadCsv(
              `${fileBase}-${new Date().toISOString().slice(0, 10)}.csv`,
              reportRowsToCsv(payload.columns, searched),
            )
          }
          className="px-3 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="mt-3 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-3 flex-wrap">
          <FilterSelect
            label="Business Unit"
            value={draft.business_unit ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, business_unit: v || undefined }))}
            options={masters.businessUnits}
          />
          <FilterSelect
            label="Department"
            value={draft.department ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, department: v || undefined }))}
            options={masters.departments}
          />
          <FilterSelect
            label="Location"
            value={draft.location ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, location: v || undefined }))}
            options={masters.locations}
          />
          <FilterSelect
            label="Cost Center"
            value={draft.cost_center ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, cost_center: v || undefined }))}
            options={masters.costCenters}
          />
          <FilterSelect
            label="Legal Entity"
            value={draft.legal_entity ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, legal_entity: v || undefined }))}
            options={masters.legalEntities}
          />
          <label className="flex flex-col gap-1 min-w-[130px] flex-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Band
            </span>
            <input
              value={draft.band ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, band: e.target.value }))}
              placeholder="e.g. G3"
              className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
            }}
            className="px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              setApplied(draft);
              setPage(1);
            }}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Run
          </button>
        </div>
      </div>

      {/* Search + table */}
      <div className="mt-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 pb-0">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search these rows"
            aria-label="Search these rows"
            className="w-full max-w-sm px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
          />
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading report…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-red-600">{error}</p>
        ) : payload?.unavailable ? (
          <div className="p-5">
            <p className="py-8 text-center text-sm text-slate-500">
              {payload.unavailable}
            </p>
          </div>
        ) : searched.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {search.trim() ? `No rows match “${search.trim()}”.` : 'No rows.'}
          </p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50">
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className="px-4 py-2.5 text-slate-700 whitespace-nowrap max-w-[280px] truncate"
                          title={String(row[c.key] ?? '')}
                        >
                          {String(row[c.key] ?? '') || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={searched.length} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
