'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fullName, orgApi, type NamedEntity, type OrgEmployee, type OrgPosition } from '@/lib/api/org';
import { MasterTable, StatusPill } from '@/components/org-module/ui';

interface PositionRow {
  id: string;
  title: string;
  department: string;
  jobTitle: string;
  level: string;
  reportsTo: string;
  status: string;
  incumbent: string;
}

const STATUS_LABEL: Record<string, string> = {
  filled: 'Filled',
  vacant: 'Vacant',
  hiring: 'Hiring',
  on_hold: 'On Hold',
};

export default function PositionsPage() {
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [poss, depts, desigs, levels, directory] = (await Promise.all([
        orgApi.listPositions(),
        orgApi.listDepartments(),
        orgApi.listDesignations(),
        orgApi.listLevels(),
        orgApi.listDirectory(),
      ])) as [OrgPosition[], NamedEntity[], NamedEntity[], NamedEntity[], OrgEmployee[]];
      const deptNames = new Map(depts.map((d) => [d.id, d.name]));
      const desigNames = new Map(desigs.map((d) => [d.id, d.name]));
      const levelNames = new Map(levels.map((l) => [l.id, l.name]));
      const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));
      const posNames = new Map(poss.map((p) => [p.id, p.name]));
      setRows(
        poss.map((p) => ({
          id: p.id,
          title: p.name || '—',
          department: (p.department_id && deptNames.get(p.department_id)) || '—',
          jobTitle: (p.job_title_id && desigNames.get(p.job_title_id)) || '—',
          level: (p.level_id && levelNames.get(p.level_id)) || '—',
          reportsTo: (p.reports_to_id && posNames.get(p.reports_to_id)) || '—',
          status: STATUS_LABEL[p.status] ?? p.status,
          incumbent: (p.incumbent_id && empNames.get(p.incumbent_id)) || '—',
        })),
      );
    } catch {
      setRows([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const table = useMemo(
    () => (
      <MasterTable<PositionRow>
        title="Positions"
        subtitle="Approved seats from the positions registry — a seat exists even when vacant (live reads; add/edit not yet wired)."
        rows={rows}
        fields={[]}
        addLabel="Add position"
        canManage={false}
        searchPlaceholder="Search by title, department or incumbent…"
        columns={[
          { key: 'title', label: 'Position' },
          { key: 'department', label: 'Department' },
          { key: 'jobTitle', label: 'Job title' },
          { key: 'level', label: 'Level' },
          { key: 'reportsTo', label: 'Reports to' },
          { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
          { key: 'incumbent', label: 'Incumbent' },
        ]}
      />
    ),
    [rows],
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
        <div className="h-5 w-40 bg-slate-100 rounded" />
        <div className="mt-3 h-40 bg-slate-50 rounded-xl" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-sm text-amber-800">Couldn&apos;t reach the positions registry.</p>
        <button
          type="button"
          onClick={refresh}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return table;
}
