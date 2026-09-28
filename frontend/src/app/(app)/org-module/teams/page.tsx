'use client';

import { useCallback, useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee, type OrgTeam } from '@/lib/api/org';
import { MasterTable, StatusPill } from '@/components/org-module/ui';

interface TeamRow {
  id: string;
  name: string;
  department: string;
  lead: string;
  status: string;
}

/** Teams read live from the team registry, with department and lead resolved
 * to real names from the directory masters. */
export default function TeamsPage() {
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [teams, depts, directory] = (await Promise.all([
        orgApi.listTeams(),
        orgApi.listDepartments(),
        orgApi.listDirectory(),
      ])) as [OrgTeam[], { id: string; name: string }[], OrgEmployee[]];
      const deptNames = new Map(depts.map((d) => [d.id, d.name]));
      const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));
      setRows(
        teams.map((t) => ({
          id: t.id,
          name: t.name,
          department: (t.department_id && deptNames.get(t.department_id)) || '—',
          lead: (t.lead_id && empNames.get(t.lead_id)) || '—',
          status: 'Active',
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
        <p className="text-sm text-amber-800">Couldn&apos;t reach the team registry.</p>
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

  return (
    <MasterTable<TeamRow>
      title="Teams"
      subtitle="Working groups from the live team registry, lead resolved to a real directory name (reads are live; add/edit not yet wired)."
      rows={rows}
      fields={[]}
      addLabel="Add team"
      canManage={false}
      searchPlaceholder="Search by team, department or lead…"
      columns={[
        { key: 'name', label: 'Team' },
        { key: 'department', label: 'Department' },
        { key: 'lead', label: 'Lead' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
      ]}
    />
  );
}
