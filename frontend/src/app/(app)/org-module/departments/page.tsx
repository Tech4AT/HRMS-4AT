'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { orgApi } from '@/lib/api/org';
import type { Department } from '@/lib/mock/org/types';
import { MasterTable, PageHeader, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Department name', placeholder: 'e.g. Engineering' },
  { name: 'code', label: 'Code', placeholder: 'e.g. DEPT-ENG' },
  {
    name: 'parent',
    label: 'Parent business unit',
    type: 'select',
    options: ['Product & Engineering', 'Consulting Services', 'Corporate'],
  },
  { name: 'head', label: 'Department head', placeholder: 'e.g. Arjun Mehta' },
];

export default function DepartmentsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<Department[]>([]);
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
      setRows(
        depts.map((d) => ({
          id: d.id,
          name: d.name,
          code: '—',
          parent: '—',
          head: '—',
          // No team registry on the backend yet — teams are visible on the Teams screen.
          teams: 0,
          employees: employees.filter((emp) => emp.department_id === d.id).length,
          status: 'Active',
        }) as Department),
      );
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
        <PageHeader title="Departments" subtitle="Loading…" />
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
      <MasterTable<Department>
        title="Departments"
        subtitle="Live names and headcount from the server; codes, parents and heads are not stored by the backend yet (stub actions)."
        rows={rows}
        fields={fields}
        addLabel="Add department"
        canManage={canManage}
        searchPlaceholder="Search by name, code, parent or head…"
        columns={[
          { key: 'name', label: 'Department' },
          { key: 'code', label: 'Code' },
          { key: 'parent', label: 'Parent unit' },
          { key: 'head', label: 'Head' },
          { key: 'teams', label: 'Teams' },
          { key: 'employees', label: 'Employees' },
          { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
        ]}
      />
    </div>
  );
}
