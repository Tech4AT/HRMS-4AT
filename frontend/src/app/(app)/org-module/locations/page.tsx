'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { orgApi } from '@/lib/api/org';
import type { OrgLocation } from '@/lib/mock/org/types';
import { MasterTable, PageHeader, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Location name', placeholder: 'e.g. Bengaluru HQ' },
  { name: 'code', label: 'Code', placeholder: 'e.g. BLR-HQ' },
  { name: 'city', label: 'City', placeholder: 'e.g. Bengaluru' },
  { name: 'country', label: 'Country', type: 'select', options: ['India', 'United States'] },
];

export default function LocationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<OrgLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [locs, employees] = await Promise.all([
        orgApi.listLocations(),
        orgApi.listEmployees(),
      ]);
      setRows(
        locs.map((l) => ({
          id: l.id,
          name: l.name,
          code: '—',
          city: '—',
          country: '—',
          employees: employees.filter((emp) => emp.location_id === l.id).length,
          status: 'Active',
        }) as OrgLocation),
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
        <PageHeader title="Locations" subtitle="Loading…" />
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
      <MasterTable<OrgLocation>
        title="Locations"
        subtitle="Live names and headcount from the server; codes and cities are not stored by the backend yet (stub actions)."
        rows={rows}
        fields={fields}
        addLabel="Add location"
        canManage={canManage}
        searchPlaceholder="Search by name, code or city…"
        columns={[
          { key: 'name', label: 'Location' },
          { key: 'code', label: 'Code' },
          { key: 'city', label: 'City' },
          { key: 'country', label: 'Country' },
          { key: 'employees', label: 'Employees' },
          { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
        ]}
      />
    </div>
  );
}
