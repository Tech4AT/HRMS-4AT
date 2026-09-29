'use client';

/**
 * Unified Org Structure screen: Keka-style sub-tab bar + master-detail.
 *
 * Each sub-tab: left rail (search + "ACTIVE <THING> (N)" grouped list with
 * avatar/initials) and a right detail panel. Lists degrade gracefully —
 * one failing list never blanks the screen (Promise.allSettled). Every kind
 * with an admin resource is enriched from the audited admin list (code,
 * description, parent/child, employee counts, full camelCase row); when the
 * caller may not read it the screen silently keeps the read-only names.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { fullName, orgApi, type CostCenter, type NamedEntity, type OrgEmployee, type OrgTeam } from '@/lib/api/org';
import {
  adminDelete,
  adminList,
  configFor,
  initials,
  membersOf,
  mergeAdminRows,
  OrgAdminError,
  TYPE_CONFIGS,
  type UnitItem,
  type UnitKind,
} from './org-structure-types';
import { DetailPanel, EMPTY_FK_OPTIONS, UnitDrawer, type DrawerState, type FkOptions } from './org-structure-detail';

/** Sub-tabs live on the bar. Pay Grades/Bands are EXAMPLE placeholders (no payroll link). */
export const VISIBLE_TABS: UnitKind[] = [
  'legal-entities',
  'business-units',
  'locations',
  'departments',
  'teams',
  'cost-centers',
  'job-families',
  'levels',
  'grades',
  'job-titles',
  'pay-grades',
  'bands',
];

function toItems(entities: NamedEntity[]): UnitItem[] {
  return entities.map((e) => ({ id: e.id, name: e.name }));
}

async function loadKind(kind: UnitKind): Promise<UnitItem[]> {
  switch (kind) {
    case 'legal-entities':
      return toItems(await orgApi.listLegalEntities());
    case 'business-units':
      return toItems(await orgApi.listBusinessUnits());
    case 'locations':
      return toItems(await orgApi.listLocations());
    case 'departments':
      return toItems(await orgApi.listDepartments());
    case 'teams': {
      const rows: OrgTeam[] = await orgApi.listTeams();
      return rows.map((t) => ({ id: t.id, name: t.name }));
    }
    case 'cost-centers': {
      const rows: CostCenter[] = await orgApi.listCostCenters();
      return rows.map((c) => ({ id: c.id, name: c.name, code: c.code }));
    }
    case 'job-families':
      return toItems(await orgApi.listJobFamilies());
    case 'levels':
      return toItems(await orgApi.listLevels());
    case 'grades':
      return toItems(await orgApi.listGrades());
    case 'job-titles':
      return toItems(await orgApi.listJobTitles());
    case 'pay-grades':
    case 'bands': {
      // No read-only directory feed for these — the admin list doubles as the
      // source of names. Non-managers (403 -> null) see an honest empty rail;
      // the detail panel explains the gate.
      const resource = configFor(kind).adminResource as string;
      const rows = await adminList(resource);
      return (rows ?? []).map((r) => ({
        id: String(r.id),
        name: r.name,
        code: typeof r.code === 'string' ? r.code : undefined,
        description: typeof r.description === 'string' ? r.description : undefined,
        admin: r as Record<string, unknown>,
      }));
    }
  }
}

export function OrgStructureScreen({ initialTab }: { initialTab?: string }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const tabs = useMemo(() => VISIBLE_TABS.map((k) => configFor(k)), []);
  const [activeTab, setActiveTab] = useState<UnitKind>(() => {
    const fromUrl = tabs.find((t) => t.kind === initialTab)?.kind;
    return fromUrl ?? VISIBLE_TABS[0];
  });
  const cfg = configFor(activeTab);

  const [unitsByKind, setUnitsByKind] = useState<Partial<Record<UnitKind, UnitItem[]>>>({});
  const [failedKinds, setFailedKinds] = useState<Set<UnitKind>>(new Set());
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [selectedByKind, setSelectedByKind] = useState<Partial<Record<UnitKind, string>>>({});
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [deleting, setDeleting] = useState<UnitItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);

  /** Re-merge one kind from its admin list (used after add/edit too). */
  const mergeKind = useCallback(async (kind: UnitKind, items: UnitItem[]): Promise<UnitItem[]> => {
    const resource = configFor(kind).adminResource;
    if (!resource) return items;
    try {
      const rows = await adminList(resource);
      return mergeAdminRows(items, rows);
    } catch {
      return items;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled(VISIBLE_TABS.map((k) => loadKind(k)));
    const next: Partial<Record<UnitKind, UnitItem[]>> = {};
    const failed = new Set<UnitKind>();
    settled.forEach((r, i) => {
      const kind = VISIBLE_TABS[i];
      if (r.status === 'fulfilled') next[kind] = r.value;
      else {
        next[kind] = [];
        failed.add(kind);
      }
    });

    // Enrich every kind that has an admin resource. One slow/failing admin
    // list never blocks the others (allSettled again).
    const enriched = await Promise.allSettled(
      VISIBLE_TABS.filter((k) => next[k]).map(async (kind) => ({
        kind,
        items: await mergeKind(kind, next[kind] as UnitItem[]),
      })),
    );
    for (const r of enriched) {
      if (r.status === 'fulfilled') next[r.value.kind] = r.value.items;
    }

    setUnitsByKind(next);
    setFailedKinds(failed);

    try {
      setDirectory(await orgApi.listDirectory());
      setDirectoryFailed(false);
    } catch {
      setDirectory([]);
      setDirectoryFailed(true);
    } finally {
      setLoading(false);
    }
  }, [mergeKind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const units = unitsByKind[activeTab] ?? [];

  /** FK picker options, derived from the already-loaded masters + directory. */
  const fkOptions: FkOptions = useMemo(() => {
    const named = (list: UnitItem[] | undefined) =>
      (list ?? []).map((u) => ({ id: u.id, name: u.name }));
    return {
      ...EMPTY_FK_OPTIONS,
      employee: directory.map((e) => ({ id: e.id, name: fullName(e) })),
      department: named(unitsByKind.departments),
      location: named(unitsByKind.locations),
      'legal-entity': named(unitsByKind['legal-entities']),
      'business-unit': named(unitsByKind['business-units']),
      'cost-center': named(unitsByKind['cost-centers']),
      'job-family': named(unitsByKind['job-families']),
      level: named(unitsByKind.levels),
      'job-title': named(unitsByKind['job-titles']),
      'pay-grade': named(unitsByKind['pay-grades']),
    };
  }, [directory, unitsByKind]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => `${u.name} ${u.code ?? ''} ${u.description ?? ''}`.toLowerCase().includes(q));
  }, [units, search]);

  const selected: UnitItem | null = useMemo(() => {
    const id = selectedByKind[activeTab];
    return visible.find((u) => u.id === id) ?? visible[0] ?? units[0] ?? null;
  }, [selectedByKind, activeTab, visible, units]);

  useEffect(() => {
    setSearch('');
    setDeleting(null);
    setDeleteError(null);
  }, [activeTab]);

  function upsertUnit(kind: UnitKind, saved: { id: string; name: string; code?: string }, mode: 'add' | 'edit') {
    setUnitsByKind((prev) => {
      const list = [...(prev[kind] ?? [])];
      if (mode === 'add') {
        const existing = list.find((u) => u.id === saved.id);
        if (!existing) list.push({ id: saved.id, name: saved.name, code: saved.code });
        else {
          existing.name = saved.name;
          if (saved.code !== undefined) existing.code = saved.code;
        }
      } else {
        const row = list.find((u) => u.id === saved.id);
        if (row) {
          row.name = saved.name;
          if (saved.code !== undefined) row.code = saved.code;
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      return { ...prev, [kind]: list };
    });
    setSelectedByKind((prev) => ({ ...prev, [kind]: saved.id }));
    // Re-merge the admin row so the detail panel shows the saved FKs at once.
    mergeKind(kind, unitsByKind[kind] ?? [])
      .then((items) => {
        setUnitsByKind((prev) => {
          const savedRow = items.find((u) => u.id === saved.id);
          const list = [...(prev[kind] ?? [])];
          const idx = list.findIndex((u) => u.id === saved.id);
          const merged: UnitItem =
            idx >= 0
              ? { ...list[idx], ...(savedRow ?? {}) }
              : ({ ...savedRow, id: saved.id, name: saved.name } as UnitItem);
          if (idx >= 0) list[idx] = merged;
          else list.push(merged);
          list.sort((a, b) => a.name.localeCompare(b.name));
          return { ...prev, [kind]: list };
        });
      })
      .catch(() => {});
  }

  async function confirmDelete() {
    if (!deleting || !cfg.adminResource) return;
    setDeletingNow(true);
    setDeleteError(null);
    try {
      await adminDelete(cfg.adminResource, deleting.id);
      const removedId = deleting.id;
      setUnitsByKind((prev) => ({
        ...prev,
        [activeTab]: (prev[activeTab] ?? []).filter((u) => u.id !== removedId),
      }));
      setSelectedByKind((prev) => {
        const nextSel = { ...prev };
        if (nextSel[activeTab] === removedId) delete nextSel[activeTab];
        return nextSel;
      });
      setDeleting(null);
    } catch (e) {
      setDeleteError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
    } finally {
      setDeletingNow(false);
    }
  }

  function handleParentSaved(childId: string, parentId: string | null) {
    setUnitsByKind((prev) => ({
      ...prev,
      departments: (prev.departments ?? []).map((d) =>
        d.id === childId
          ? {
              ...d,
              parentId,
              parentName: parentId
                ? ((prev.departments ?? []).find((x) => x.id === parentId)?.name ?? null)
                : null,
            }
          : d,
      ),
    }));
  }

  if (loading) {
    return (
      <div>
        <div className="h-10 w-2/3 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
            <div className="h-9 bg-slate-100 rounded-lg" />
            <div className="mt-3 space-y-2">
              <div className="h-10 bg-slate-50 rounded-lg" />
              <div className="h-10 bg-slate-50 rounded-lg" />
              <div className="h-10 bg-slate-50 rounded-lg" />
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
            <div className="h-5 w-1/3 bg-slate-100 rounded" />
            <div className="mt-3 h-24 bg-slate-50 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900">Org Structure</h2>
        <span className="flex gap-2">
          {activeTab === 'locations' ? (
            <button
              type="button"
              disabled
              title="Coming soon"
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-400 cursor-not-allowed"
            >
              Import Location
            </button>
          ) : null}
          {canManage && cfg.adminResource ? (
            <button
              type="button"
              onClick={() => setDrawer({ mode: 'add' })}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Add {cfg.singular}
            </button>
          ) : null}
        </span>
      </div>

      {directoryFailed ? (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          Employee counts are unavailable — the directory didn&apos;t load. Names below are still live.
        </p>
      ) : null}

      {/* sub-tab bar */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl px-2 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setActiveTab(t.kind)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === t.kind
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* master-detail */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr] items-start">
        {/* left rail */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${cfg.plural.toLowerCase()}…`}
            aria-label={`Search ${cfg.plural}`}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
          <p className="mt-4 mb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            Active {cfg.plural} ({visible.length})
          </p>
          {failedKinds.has(activeTab) ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-amber-800">Couldn&apos;t reach the server — showing no records.</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {cfg.kind === 'pay-grades' || cfg.kind === 'bands'
                ? `No ${cfg.plural.toLowerCase()} yet — example placeholders, add one to start the registry.`
                : `No ${cfg.plural.toLowerCase()} yet.`}
            </p>
          ) : (
            <ul className="space-y-1 max-h-[560px] overflow-y-auto">
              {visible.map((u) => {
                const isSel = selected?.id === u.id;
                const count = cfg.employeeKey ? membersOf(directory, cfg.employeeKey, u.id, units).length : null;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedByKind((p) => ({ ...p, [activeTab]: u.id }))}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                        isSel ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-8 h-8 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                          isSel ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {initials(u.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800 truncate">{u.name}</span>
                        {u.code ? (
                          <span className="block text-[11px] text-slate-400 truncate">{u.code}</span>
                        ) : count !== null ? (
                          <span className="block text-[11px] text-slate-400">
                            {count} {count === 1 ? 'employee' : 'employees'}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* detail */}
        <div>
          {selected ? (
            <DetailPanel
              kind={activeTab}
              item={selected}
              employees={directory}
              allUnits={units}
              fkOptions={fkOptions}
              canManage={canManage}
              onEdit={() => setDrawer({ mode: 'edit', item: selected })}
              onDelete={() => {
                setDeleteError(null);
                setDeleting(selected);
              }}
              onParentSaved={handleParentSaved}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="py-10 text-center text-sm text-slate-500">
                {cfg.kind === 'pay-grades' || cfg.kind === 'bands'
                  ? `No ${cfg.plural.toLowerCase()} to show yet — example placeholders, add one to start the registry.`
                  : `No ${cfg.plural.toLowerCase()} to show.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* add/edit drawer */}
      {drawer ? (
        <UnitDrawer
          kind={activeTab}
          state={drawer}
          allUnits={units}
          fkOptions={fkOptions}
          canManage={canManage}
          onClose={() => setDrawer(null)}
          onSaved={(saved) => upsertUnit(activeTab, saved, drawer.mode)}
        />
      ) : null}

      {/* delete confirm */}
      {deleting ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDeleting(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${cfg.singular}`}
        >
          <div
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-900">
              Delete {cfg.singular} “{deleting.name}”?
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {cfg.employeeKey
                ? 'This is blocked while any employee is still assigned to it — move them first.'
                : 'This cannot be undone.'}
            </p>
            {deleteError ? <p className="mt-2 text-xs font-medium text-rose-600">{deleteError}</p> : null}
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletingNow}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
              >
                {deletingNow ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** All tab kinds in config order (used by redirects + the page). */
export const ALL_TAB_KINDS: UnitKind[] = TYPE_CONFIGS.map((c) => c.kind);
