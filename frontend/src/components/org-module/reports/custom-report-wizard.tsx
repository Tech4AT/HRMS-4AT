'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  type ReportFieldGroup,
  type ReportFilters,
  type ReportPayload,
  type SavedReport,
} from '@/lib/admin/api';
import type { ReportMasters } from './report-view';

export interface WizardBase {
  id: string;
  title: string;
  description: string;
}

const STEPS = ['Report Type', 'Data View', 'Filter & Grouping', 'Save Report'];

function MiniSelect({
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
    <label className="flex flex-col gap-1">
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

export function CustomReportWizard({
  bases,
  fieldGroups,
  masters,
  onClose,
  onSaved,
}: {
  bases: WizardBase[];
  fieldGroups: ReportFieldGroup[];
  masters: ReportMasters;
  onClose: () => void;
  onSaved: (report: SavedReport) => void;
}) {
  const [step, setStep] = useState(0);
  const [base, setBase] = useState(bases[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [groupBy, setGroupBy] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<ReportPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of fieldGroups) for (const f of g.fields) map.set(f.key, f.label);
    return selected.map((k) => ({ key: k, label: map.get(k) ?? k }));
  }, [fieldGroups, selected]);

  const availableByGroup = useMemo(
    () =>
      fieldGroups.map((g) => ({
        ...g,
        fields: g.fields.filter((f) => !selected.includes(f.key)),
      })),
    [fieldGroups, selected],
  );

  // Live preview whenever the data view inputs change.
  useEffect(() => {
    if (step !== 1 && step !== 2) return;
    if (!base || selected.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    adminApi
      .runReport(base, {
        business_unit: filters.business_unit || undefined,
        department: filters.department || undefined,
        location: filters.location || undefined,
        cost_center: filters.cost_center || undefined,
        legal_entity: filters.legal_entity || undefined,
        band: filters.band?.trim() || undefined,
      }, selected)
      .then(
        (data) => {
          if (!cancelled) {
            setPreview(data);
            setPreviewLoading(false);
          }
        },
        () => {
          if (!cancelled) setPreviewLoading(false);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [step, base, selected, filters]);

  const groupedPreview = useMemo(() => {
    const rows = preview?.rows.slice(0, 30) ?? [];
    if (!groupBy) return null;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const k = String(row[groupBy] ?? '') || '—';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(row);
    }
    return [...groups.entries()];
  }, [preview, groupBy]);

  const canNext =
    step === 0 ? !!base : step === 1 ? selected.length > 0 : step === 2 ? true : name.trim().length > 0;

  async function save() {
    if (!name.trim() || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await adminApi.createCustomReport({
        name: name.trim(),
        base_type: base,
        selected_fields: selected,
        filters: Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v && String(v).trim()),
        ) as Record<string, string>,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this report.');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Create Custom Report"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">Create Custom Report</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="px-2 py-1 text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>

        <ol className="mt-3 flex gap-1" aria-label="Wizard steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex-1">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                className={`w-full px-2 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  i === step
                    ? 'bg-indigo-600 text-white'
                    : i < step
                      ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          {step === 0 && (
            <div>
              <p className="text-sm text-slate-600">
                Pick a base report. Its rows become your starting point.
              </p>
              <div className="mt-3 space-y-2">
                {bases.map((b) => (
                  <label
                    key={b.id}
                    className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                      base === b.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="wizard-base"
                      checked={base === b.id}
                      onChange={() => setBase(b.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        {b.title}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {b.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <h4 className="mt-4 text-xs font-bold text-slate-500 uppercase tracking-wide">
                Available field groups
              </h4>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fieldGroups.map((g) => (
                  <div
                    key={g.name}
                    className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                    <p className="text-xs text-slate-500">{g.count} fields</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Available fields
                </h4>
                <div className="mt-2 space-y-3 max-h-72 overflow-y-auto pr-1">
                  {availableByGroup.map((g) => (
                    <div key={g.name}>
                      <p className="text-xs font-semibold text-slate-600">
                        {g.name} ({g.fields.length})
                      </p>
                      <div className="mt-1 space-y-1">
                        {g.fields.map((f) => (
                          <div
                            key={f.key}
                            className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200"
                          >
                            <span className="text-sm text-slate-700">{f.label}</span>
                            <button
                              type="button"
                              onClick={() => setSelected((s) => [...s, f.key])}
                              aria-label={`Add ${f.label}`}
                              className="px-2 py-0.5 text-xs font-bold rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                              +
                            </button>
                          </div>
                        ))}
                        {g.fields.length === 0 && (
                          <p className="text-xs text-slate-400 px-1">
                            All fields from this group are selected.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Selected fields ({selected.length})
                </h4>
                <div className="mt-2 space-y-1 max-h-72 overflow-y-auto pr-1">
                  {selectedLabels.map((f) => (
                    <div
                      key={f.key}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200"
                    >
                      <span className="text-sm text-slate-800">{f.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected((s) => s.filter((k) => k !== f.key));
                          if (groupBy === f.key) setGroupBy('');
                        }}
                        aria-label={`Remove ${f.label}`}
                        className="px-2 py-0.5 text-xs font-bold rounded-md bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {selected.length === 0 && (
                    <p className="text-sm text-slate-400">
                      Add fields from the left to build your view.
                    </p>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Live preview
                </h4>
                {previewLoading ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    Loading preview…
                  </p>
                ) : !preview || preview.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    {selected.length === 0
                      ? 'Select at least one field to preview.'
                      : (preview?.unavailable ?? 'No rows for this selection.')}
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          {preview.columns.map((c) => (
                            <th
                              key={c.key}
                              scope="col"
                              className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase whitespace-nowrap"
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            {preview.columns.map((c) => (
                              <td key={c.key} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                                {String(row[c.key] ?? '') || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-3 py-2 text-xs text-slate-500">
                      Showing 5 of {preview.total} rows.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm text-slate-600">
                Narrow the rows now, or leave everything open. Filters are saved
                with the report.
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MiniSelect
                  label="Business Unit"
                  value={filters.business_unit ?? ''}
                  onChange={(v) => setFilters((f) => ({ ...f, business_unit: v || undefined }))}
                  options={masters.businessUnits}
                />
                <MiniSelect
                  label="Department"
                  value={filters.department ?? ''}
                  onChange={(v) => setFilters((f) => ({ ...f, department: v || undefined }))}
                  options={masters.departments}
                />
                <MiniSelect
                  label="Location"
                  value={filters.location ?? ''}
                  onChange={(v) => setFilters((f) => ({ ...f, location: v || undefined }))}
                  options={masters.locations}
                />
                <MiniSelect
                  label="Cost Center"
                  value={filters.cost_center ?? ''}
                  onChange={(v) => setFilters((f) => ({ ...f, cost_center: v || undefined }))}
                  options={masters.costCenters}
                />
                <MiniSelect
                  label="Legal Entity"
                  value={filters.legal_entity ?? ''}
                  onChange={(v) => setFilters((f) => ({ ...f, legal_entity: v || undefined }))}
                  options={masters.legalEntities}
                />
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Band
                  </span>
                  <input
                    value={filters.band ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, band: e.target.value }))}
                    placeholder="e.g. G3"
                    className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                </label>
              </div>
              <div className="mt-3">
                <label className="flex flex-col gap-1 max-w-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Group preview rows by (display only)
                  </span>
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  >
                    <option value="">No grouping</option>
                    {selectedLabels.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                {groupedPreview && (
                  <div className="mt-2 space-y-2">
                    {groupedPreview.map(([group, rows]) => (
                      <div key={group} className="border border-slate-200 rounded-xl overflow-hidden">
                        <p className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50">
                          {group} ({rows.length})
                        </p>
                        <p className="px-3 py-2 text-xs text-slate-500">
                          {rows.length} row{rows.length === 1 ? '' : 's'} in this group.
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="text-sm text-slate-600">
                Name it — the report then appears under its category and on
                Reports Home.
              </p>
              <label className="mt-3 flex flex-col gap-1 max-w-md">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Report name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Engineering ward roster"
                  className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </label>
              <dl className="mt-3 text-sm text-slate-600 space-y-1">
                <div className="flex gap-2">
                  <dt className="font-semibold">Base:</dt>
                  <dd>{bases.find((b) => b.id === base)?.title}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold">Fields:</dt>
                  <dd>{selected.length}</dd>
                </div>
              </dl>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={!canNext || saving}
              onClick={save}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Report'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

