'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adminApi,
  reportRowsToCsv,
  type ReportCatalog,
  type SavedReport,
} from '@/lib/admin/api';
import { orgApi } from '@/lib/api/org';
import {
  ReportView,
  type ReportMasters,
  type ReportTarget,
} from './reports/report-view';
import { CustomReportWizard, type WizardBase } from './reports/custom-report-wizard';

/** Employee Reports (Org Dashboard > Employee Reports): Keka-style category
 *  rail + two-column report cards, backed by the reports engine
 *  (org/reports/*). Saved custom reports show as cards beside the built-ins. */

interface Card {
  key: string;
  target: ReportTarget;
  title: string;
  description: string;
  category: string;
  custom: boolean;
  disabled?: string | null;
}

const EMPTY_MASTERS: ReportMasters = {
  businessUnits: [],
  departments: [],
  locations: [],
  costCenters: [],
  legalEntities: [],
};

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

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
      <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.3 0-7 1.2-7 3.5V19h10v-2.5c0-1 .5-2 1.5-2.8A9 9 0 0 0 8 13Zm8 0c-.3 0-.7 0-1.1.1 1.3.8 2.1 1.9 2.1 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5Z" />
    </svg>
  );
}

function CardMenu({
  card,
  onOpen,
  onExport,
  onDelete,
}: {
  card: Card;
  onOpen: () => void;
  onExport: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item =
    'block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50';
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Options for ${card.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="px-2 py-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 text-lg leading-none"
      >
        ⋮
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onOpen();
            }}
          >
            Open
          </button>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onExport();
            }}
          >
            Export CSV
          </button>
          {onDelete && (
            <button
              role="menuitem"
              type="button"
              className={`${item} text-red-600`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  card,
  onOpen,
  onExport,
  onDelete,
}: {
  card: Card;
  onOpen: () => void;
  onExport: () => void;
  onDelete?: () => void;
}) {
  const disabled = !!card.disabled;
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      title={card.disabled ?? undefined}
      onClick={() => !disabled && onOpen()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`flex items-start justify-between gap-3 px-5 py-4 bg-white border border-slate-200 rounded-lg transition-colors ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-indigo-300 hover:shadow-sm'
      }`}
    >
      <div className={`min-w-0 ${disabled ? 'opacity-50' : ''}`}>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="truncate">{card.title}</span>
          {card.custom && (
            <span className="text-slate-400" title="Custom report">
              <PeopleIcon />
            </span>
          )}
        </p>
        <p className="mt-1.5 text-sm text-slate-500 line-clamp-2">
          {disabled ? card.disabled : card.description}
        </p>
      </div>
      {!disabled && (
        <CardMenu card={card} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
      )}
    </div>
  );
}

export function ReportsTab() {
  const [catalog, setCatalog] = useState<ReportCatalog | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [masters, setMasters] = useState<ReportMasters>(EMPTY_MASTERS);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>('employee_info');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReportTarget | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [cat, list] = await Promise.all([
        adminApi.getReportCatalog(),
        adminApi.listCustomReports(),
      ]);
      setCatalog(cat);
      setSaved(list.results ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load reports.');
    }
  }, []);

  useEffect(() => {
    void reload();
    // Filter dropdown sources; a failed list just leaves that dropdown empty.
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    Promise.all([
      safe(orgApi.listBusinessUnits()),
      safe(orgApi.listDepartments()),
      safe(orgApi.listLocations()),
      safe(orgApi.listCostCenters()),
      safe(orgApi.listLegalEntities()),
    ]).then(([businessUnits, departments, locations, costCenters, legalEntities]) =>
      setMasters({ businessUnits, departments, locations, costCenters, legalEntities }),
    );
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Every card (built-in + saved custom), tagged with its category.
  const cards = useMemo<Card[]>(() => {
    if (!catalog) return [];
    const byId = new Map<string, string>();
    const out: Card[] = [];
    for (const cat of catalog.categories) {
      for (const r of cat.reports) {
        byId.set(r.id, cat.id);
        out.push({
          key: `r:${r.id}`,
          target: { kind: 'report', id: r.id },
          title: r.title,
          description: r.description,
          category: cat.id,
          custom: false,
          disabled: r.wired ? null : (r.unavailable ?? 'No data source yet'),
        });
      }
    }
    for (const s of saved) {
      out.push({
        key: `s:${s.id}`,
        target: { kind: 'saved', id: s.id, name: s.name },
        title: s.name,
        description: `Custom report · ${s.selected_fields.length} fields`,
        category: byId.get(s.base_type) ?? 'employee_info',
        custom: true,
      });
    }
    return out;
  }, [catalog, saved]);

  const bases = useMemo<WizardBase[]>(
    () =>
      (catalog?.categories ?? [])
        .flatMap((c) => c.reports)
        .filter((r) => r.customizable)
        .map((r) => ({ id: r.id, title: r.title, description: r.description })),
    [catalog],
  );

  const exportCard = async (card: Card) => {
    try {
      const payload =
        card.target.kind === 'report'
          ? await adminApi.runReport(card.target.id)
          : await adminApi.runSavedReport(card.target.id);
      downloadCsv(
        `${card.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`,
        reportRowsToCsv(payload.columns, payload.rows),
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not export this report.');
    }
  };

  const deleteSaved = async (card: Card) => {
    if (card.target.kind !== 'saved') return;
    if (!window.confirm(`Delete the custom report “${card.title}”?`)) return;
    try {
      await adminApi.deleteCustomReport(card.target.id);
      setSaved((s) => s.filter((x) => x.id !== (card.target as { id: number }).id));
      setToast('Report deleted.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not delete this report.');
    }
  };

  if (opened) {
    return (
      <>
        <ReportView
          target={opened}
          masters={masters}
          onBack={() => setOpened(null)}
          onSchedule={setScheduleFor}
        />
        {scheduleFor && <ScheduleNotice title={scheduleFor} onClose={() => setScheduleFor(null)} />}
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const inCategory = cards.filter((c) => c.category === category);
  const visible = (category === 'home' ? cards : inCategory).filter(
    (c) => !q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  );
  const activeLabel =
    category === 'home'
      ? 'Reports Home'
      : (catalog?.categories.find((c) => c.id === category)?.label ?? 'Reports');

  const railBtn = (id: string, label: string) => (
    <li key={id}>
      <button
        type="button"
        onClick={() => {
          setCategory(id);
          setQuery('');
        }}
        aria-current={category === id ? 'true' : undefined}
        className={`w-full text-left px-4 py-3 text-sm rounded-md transition-colors ${
          category === id
            ? 'bg-indigo-50 text-indigo-700 font-semibold'
            : 'text-slate-700 hover:bg-slate-50'
        }`}
      >
        {label}
      </button>
    </li>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-5">
      <nav
        aria-label="Report categories"
        className="bg-white border border-slate-200 rounded-lg p-3 h-fit"
      >
        <p className="px-3 pt-1 pb-2 text-base font-semibold text-slate-900">Categories</p>
        <ul className="space-y-1">
          {railBtn('home', 'Reports Home')}
          {(catalog?.categories ?? [])
            .filter((c) => c.id !== 'scheduled')
            .map((c) => railBtn(c.id, c.label))}
        </ul>
        <div className="mt-2 pt-2 border-t border-slate-100">
          <ul>{railBtn('scheduled', 'Scheduled reports')}</ul>
        </div>
      </nav>

      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-slate-900">{activeLabel}</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {category !== 'scheduled' && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={category === 'home' ? 'Search in all reports' : 'Search in this category'}
                aria-label="Search reports"
                className="w-64 px-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
              />
            )}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              disabled={bases.length === 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
            >
              Create Custom Report
            </button>
          </div>
        </div>

        {loadError ? (
          <p className="mt-6 py-10 text-center text-sm text-red-600 bg-white border border-slate-200 rounded-lg">
            {loadError}
          </p>
        ) : !catalog ? (
          <p className="mt-6 py-10 text-center text-sm text-slate-500">Loading reports…</p>
        ) : category === 'scheduled' ? (
          <p className="mt-4 py-10 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-lg">
            No scheduled reports yet.
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-4 py-10 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-lg">
            {q ? `No reports match “${query.trim()}”.` : 'No reports in this category.'}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {visible.map((card) => (
              <ReportCard
                key={card.key}
                card={card}
                onOpen={() => setOpened(card.target)}
                onExport={() => void exportCard(card)}
                onDelete={card.custom ? () => void deleteSaved(card) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {wizardOpen && catalog && (
        <CustomReportWizard
          bases={bases}
          fieldGroups={catalog.field_groups}
          masters={masters}
          onClose={() => setWizardOpen(false)}
          onSaved={(report) => {
            setWizardOpen(false);
            setSaved((s) => [report, ...s]);
            setToast(`Saved “${report.name}”.`);
            setCategory('employee_info');
            setOpened({ kind: 'saved', id: report.id, name: report.name });
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm rounded-lg bg-slate-900 text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function ScheduleNotice({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Schedule report"
    >
      <div
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-900">Schedule “{title}”</h3>
        <p className="text-sm text-slate-500 mt-1">
          Emailed/scheduled delivery isn’t available yet. Use Export CSV to download the
          report now.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
