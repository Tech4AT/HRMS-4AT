'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  reportRowsToCsv,
  type ReportCard,
  type ReportCatalog,
  type SavedReport,
} from '@/lib/admin/api';
import { orgApi } from '@/lib/api/org';
import { ReportView, type ReportMasters, type ReportTarget } from './reports/report-view';
import { CustomReportWizard } from './reports/custom-report-wizard';

const FAVS_KEY = 'org-report-favs';
const RECENT_KEY = 'org-report-recent';

function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

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

function Kebab({
  card,
  isFav,
  onOpen,
  onToggleFav,
  onExport,
  onSchedule,
}: {
  card: ReportCard;
  isFav: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
  onExport: () => void;
  onSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Actions for ${card.title}`}
        aria-expanded={open}
        className="px-2 py-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
      >
        ⋮
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-44 py-1 bg-white border border-slate-200 rounded-xl shadow-lg">
            {[
              { label: 'Open', fn: onOpen },
              { label: isFav ? 'Remove favourite' : 'Add favourite', fn: onToggleFav },
              { label: 'Export CSV', fn: onExport },
              { label: 'Schedule', fn: onSchedule },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.fn();
                }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReportCardView({
  card,
  badge,
  isFav,
  onOpen,
  onToggleFav,
  onExport,
  onSchedule,
}: {
  card: ReportCard;
  badge?: string;
  isFav: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
  onExport: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="flex items-start gap-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors">
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 truncate">
            {card.title}
          </span>
          {badge && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0">
              {badge}
            </span>
          )}
          {!card.wired && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 shrink-0"
              title={card.unavailable ?? undefined}
            >
              No data
            </span>
          )}
        </span>
        <span className="block text-xs text-slate-500 mt-0.5 line-clamp-2">
          {card.description}
        </span>
      </button>
      <Kebab
        card={card}
        isFav={isFav}
        onOpen={onOpen}
        onToggleFav={onToggleFav}
        onExport={onExport}
        onSchedule={onSchedule}
      />
    </div>
  );
}

const EMPTY_MASTERS: ReportMasters = {
  businessUnits: [],
  departments: [],
  locations: [],
  costCenters: [],
  legalEntities: [],
};

export function ReportsTab() {
  const [catalog, setCatalog] = useState<ReportCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [masters, setMasters] = useState<ReportMasters>(EMPTY_MASTERS);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [category, setCategory] = useState<string>('home');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setFavs(readIds(FAVS_KEY));
    setRecent(readIds(RECENT_KEY));
    let cancelled = false;
    adminApi.getReportCatalog().then(
      (data) => {
        if (!cancelled) setCatalog(data);
      },
      (err: Error) => {
        if (!cancelled) setCatalogError(err.message || 'Could not load reports.');
      },
    );
    adminApi.listCustomReports().then(
      (page) => {
        if (!cancelled) setSaved(page.results ?? []);
      },
      () => {},
    );
    Promise.allSettled([
      orgApi.listBusinessUnits(),
      orgApi.listDepartments(),
      orgApi.listLocations(),
      orgApi.listCostCenters(),
      orgApi.listLegalEntities(),
    ]).then((results) => {
      if (cancelled) return;
      const value = (i: number) =>
        results[i].status === 'fulfilled'
          ? (results[i] as PromiseFulfilledResult<{ id: string; name: string }[]>).value
          : [];
      setMasters({
        businessUnits: value(0),
        departments: value(1),
        locations: value(2),
        costCenters: value(3) as ReportMasters['costCenters'],
        legalEntities: value(4),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const allCards = useMemo(() => {
    const out: { category: string; card: ReportCard }[] = [];
    for (const c of catalog?.categories ?? []) {
      for (const card of c.reports) out.push({ category: c.label, card });
    }
    return out;
  }, [catalog]);

  const cardById = useMemo(() => {
    const map = new Map<string, ReportCard>();
    for (const { card } of allCards) map.set(card.id, card);
    return map;
  }, [allCards]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches = allCards.filter(
      (r) =>
        r.card.title.toLowerCase().includes(q) ||
        r.card.description.toLowerCase().includes(q),
    );
    const savedMatches = saved.filter((s) => s.name.toLowerCase().includes(q));
    return { matches, savedMatches };
  }, [query, allCards, saved]);

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      try {
        localStorage.setItem(FAVS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function openReport(id: string) {
    setTarget({ kind: 'report', id });
    setRecent((prev) => {
      const next = [id, ...prev.filter((r) => r !== id)].slice(0, 5);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function openSaved(report: SavedReport) {
    setTarget({ kind: 'saved', id: report.id, name: report.name });
  }

  async function quickExport(card: ReportCard) {
    setExporting(card.id);
    try {
      const payload = await adminApi.runReport(card.id, {});
      downloadCsv(
        `${card.id}-${new Date().toISOString().slice(0, 10)}.csv`,
        reportRowsToCsv(payload.columns, payload.rows),
      );
    } catch {
      // The full report view surfaces the error; the quick action stays silent.
    } finally {
      setExporting(null);
    }
  }

  async function deleteSaved(id: number) {
    try {
      await adminApi.deleteCustomReport(id);
      setSaved((prev) => prev.filter((s) => s.id !== id));
      setTarget((t) => (t?.kind === 'saved' && t.id === id ? null : t));
    } catch {}
  }

  const activeCategory = catalog?.categories.find((c) => c.id === category);
  const savedForCategory = (categoryId: string) =>
    saved.filter((s) => {
      const base = cardById.get(s.base_type);
      if (!base) return false;
      return catalog?.categories
        .find((c) => c.id === categoryId)
        ?.reports.some((r) => r.id === base.id);
    });

  const wizardBases = useMemo(
    () =>
      (catalog?.categories
        .find((c) => c.id === 'employee_info')
        ?.reports.filter((r) => r.wired && ['all_employees', 'master_details', 'job_details', 'without_manager'].includes(r.id))
        .map((r) => ({ id: r.id, title: r.title, description: r.description })) ?? []),
    [catalog],
  );

  if (target) {
    return (
      <div>
        <ReportView
          target={target}
          masters={masters}
          onBack={() => setTarget(null)}
          onSchedule={setScheduleTitle}
        />
        {scheduleTitle && (
          <ScheduleModal title={scheduleTitle} onClose={() => setScheduleTitle(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
      {/* Categories rail */}
      <nav
        aria-label="Report categories"
        className="bg-white border border-slate-200 rounded-xl p-3 h-fit"
      >
        <p className="px-2 pt-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
          Categories
        </p>
        <ul className="mt-1 space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => setCategory('home')}
              aria-current={category === 'home' ? 'true' : undefined}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                category === 'home'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Reports Home
            </button>
          </li>
          {(catalog?.categories ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCategory(c.id)}
                aria-current={category === c.id ? 'true' : undefined}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                  category === c.id
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main */}
      <div className="min-w-0">
        {catalogError ? (
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="py-8 text-center text-sm text-red-600">{catalogError}</p>
          </section>
        ) : !catalog ? (
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="py-8 text-center text-sm text-slate-500">Loading reports…</p>
          </section>
        ) : category === 'home' ? (
          <div role="tabpanel" aria-label="Reports Home">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search in all reports"
                  aria-label="Search in all reports"
                  className="w-full px-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Create Custom Report
              </button>
            </div>

            {searchResults !== null ? (
              <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-900">
                  Results ({searchResults.matches.length + searchResults.savedMatches.length})
                </h3>
                {searchResults.matches.length + searchResults.savedMatches.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No reports match “{query.trim()}”.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {searchResults.savedMatches.map((s) => (
                      <div key={`saved-${s.id}`}>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          My Custom Reports
                        </p>
                        <SavedCardView
                          report={s}
                          onOpen={() => openSaved(s)}
                          onDelete={() => deleteSaved(s.id)}
                          onSchedule={() => setScheduleTitle(s.name)}
                        />
                      </div>
                    ))}
                    {searchResults.matches.map((r) => (
                      <div key={r.card.id}>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          {r.category}
                        </p>
                        <ReportCardView
                          card={r.card}
                          isFav={favs.includes(r.card.id)}
                          onOpen={() => openReport(r.card.id)}
                          onToggleFav={() => toggleFav(r.card.id)}
                          onExport={() => quickExport(r.card)}
                          onSchedule={() => setScheduleTitle(r.card.title)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                {saved.length > 0 && (
                  <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-900">My Custom Reports</h3>
                    <div className="mt-3 space-y-2">
                      {saved.map((s) => (
                        <SavedCardView
                          key={s.id}
                          report={s}
                          onOpen={() => openSaved(s)}
                          onDelete={() => deleteSaved(s.id)}
                          onSchedule={() => setScheduleTitle(s.name)}
                        />
                      ))}
                    </div>
                  </section>
                )}
                <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-900">Favourites</h3>
                  {favs.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No favourites yet — open a report card’s ⋮ menu to pin it here.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {favs
                        .map((id) => cardById.get(id))
                        .filter((c): c is ReportCard => !!c)
                        .map((card) => (
                          <ReportCardView
                            key={card.id}
                            card={card}
                            isFav
                            onOpen={() => openReport(card.id)}
                            onToggleFav={() => toggleFav(card.id)}
                            onExport={() => quickExport(card)}
                            onSchedule={() => setScheduleTitle(card.title)}
                          />
                        ))}
                    </div>
                  )}
                </section>
                <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-900">Recently Used</h3>
                  {recent.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No recently used reports yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {recent
                        .map((id) => cardById.get(id))
                        .filter((c): c is ReportCard => !!c)
                        .map((card) => (
                          <ReportCardView
                            key={card.id}
                            card={card}
                            isFav={favs.includes(card.id)}
                            onOpen={() => openReport(card.id)}
                            onToggleFav={() => toggleFav(card.id)}
                            onExport={() => quickExport(card)}
                            onSchedule={() => setScheduleTitle(card.title)}
                          />
                        ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        ) : (
          activeCategory && (
            <div role="tabpanel" aria-label={activeCategory.label}>
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-900">{activeCategory.label}</h3>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {activeCategory.reports.map((card) => (
                    <ReportCardView
                      key={card.id}
                      card={card}
                      isFav={favs.includes(card.id)}
                      onOpen={() => openReport(card.id)}
                      onToggleFav={() => toggleFav(card.id)}
                      onExport={() => quickExport(card)}
                      onSchedule={() => setScheduleTitle(card.title)}
                    />
                  ))}
                  {savedForCategory(activeCategory.id).map((s) => (
                    <SavedCardView
                      key={`saved-${s.id}`}
                      report={s}
                      onOpen={() => openSaved(s)}
                      onDelete={() => deleteSaved(s.id)}
                      onSchedule={() => setScheduleTitle(s.name)}
                    />
                  ))}
                </div>
                {exporting && (
                  <p className="mt-3 text-xs text-slate-500">Preparing CSV…</p>
                )}
              </section>
            </div>
          )
        )}
      </div>

      {wizardOpen && catalog && (
        <CustomReportWizard
          bases={wizardBases}
          fieldGroups={catalog.field_groups}
          masters={masters}
          onClose={() => setWizardOpen(false)}
          onSaved={(report) => {
            setSaved((prev) => [report, ...prev]);
            setWizardOpen(false);
            setCategory('home');
            setQuery('');
            openSaved(report);
          }}
        />
      )}

      {scheduleTitle && (
        <ScheduleModal title={scheduleTitle} onClose={() => setScheduleTitle(null)} />
      )}
    </div>
  );
}

function SavedCardView({
  report,
  onOpen,
  onDelete,
  onSchedule,
}: {
  report: SavedReport;
  onOpen: () => void;
  onDelete: () => void;
  onSchedule: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-start gap-1 px-4 py-3 rounded-xl bg-indigo-50/50 border border-indigo-100">
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 truncate">
            {report.name}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0">
            Custom
          </span>
        </span>
        <span className="block text-xs text-slate-500 mt-0.5">
          {report.selected_fields.length} fields
          {Object.keys(report.filters).length > 0 && ' · filtered'}
        </span>
      </button>
      <button
        type="button"
        onClick={onSchedule}
        className="px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0"
      >
        Schedule
      </button>
      {confirming ? (
        <span className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-1 text-xs font-bold rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-2 py-1 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-600"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${report.name}`}
          className="px-2 py-1 text-slate-400 hover:text-red-600 shrink-0"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ScheduleModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Schedule ${title}`}
    >
      <div
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-900">Schedule “{title}”</h3>
        <p className="text-sm text-slate-500 mt-1">
          Recurring report emails are not enabled yet — scheduling is a stub in
          this build. Export a CSV whenever you need the latest rows.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
