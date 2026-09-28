'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import type { Team } from '@/lib/mock/org/types';
import { MasterTable, PageHeader, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Team name', placeholder: 'e.g. Platform' },
  { name: 'code', label: 'Code', placeholder: 'e.g. TEAM-PLT' },
  {
    name: 'department',
    label: 'Parent department',
    type: 'select',
    options: ['Engineering', 'Design', 'Consulting', 'Finance', 'People', 'Management'],
  },
  { name: 'lead', label: 'Team lead', placeholder: 'e.g. Kiran Shah' },
];

/**
 * No team registry exists on the backend yet, so teams are grouped live from
 * real department assignments: one row per department, with the lead resolved
 * to the manager most members in that group report to.
 */
function deriveTeams(
  employees: OrgEmployee[],
  deptNames: Map<string, string>,
  empNames: Map<string, string>,
): Team[] {
  const groups = new Map<string | null, OrgEmployee[]>();
  for (const e of employees) {
    const key = e.department_id;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([deptId, members]) => {
    const deptName = (deptId && deptNames.get(deptId)) || 'Unassigned';
    // Lead = the manager the most members in this group report to.
    const votes = new Map<string, number>();
    for (const m of members) {
      if (m.manager_id) votes.set(m.manager_id, (votes.get(m.manager_id) ?? 0) + 1);
    }
    let leadId: string | null = null;
    let leadVotes = 0;
    for (const [id, n] of votes) {
      if (n > leadVotes) {
        leadId = id;
        leadVotes = n;
      }
    }
    return {
      id: `team-${deptId ?? 'unassigned'}`,
      name: deptName,
      code: '—',
      department: deptName,
      lead: (leadId && empNames.get(leadId)) || '—',
      members: members.length,
      status: 'Active',
    } as Team;
  });
}

export default function TeamsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [depts, employees] = await Promise.all([
        orgApi.listDepartments(),
        orgApi.listEmployees(),
      ]);
      const deptNames = new Map(depts.map((d) => [d.id, d.name]));
      const empNames = new Map(employees.map((e) => [e.id, fullName(e)]));
      const derived = deriveTeams(employees, deptNames, empNames);
      const withEmpty = [
        ...derived,
        ...depts
          .filter((d) => !derived.some((t) => t.department === d.name))
          .map(
            (d) =>
              ({
                id: `team-${d.id}`,
                name: d.name,
                code: '—',
                department: d.name,
                lead: '—',
                members: 0,
                status: 'Active',
              }) as Team,
          ),
      ];
      setRows(withEmpty);
    } catch {
      // Never an error screen: empty table with a retry affordance.
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
      <div>
        <PageHeader title="Teams" subtitle="Loading…" />
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
          <p className="text-sm text-amber-800">
            Couldn&apos;t reach the server — showing no records.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}
      <MasterTable<Team>
        title="Teams"
        subtitle="Grouped live from department assignments — no team registry on the backend yet (stub actions)."
        rows={rows}
        fields={fields}
        addLabel="Add team"
        canManage={canManage}
        searchPlaceholder="Search by name, code, department or lead…"
        columns={[
          { key: 'name', label: 'Team' },
          { key: 'code', label: 'Code' },
          { key: 'department', label: 'Department' },
          { key: 'lead', label: 'Lead' },
          { key: 'members', label: 'Members' },
          { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
        ]}
      />
    </div>
  );
}
