'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { orgApi } from '@/lib/api/org';
import type { LegalEntity } from '@/lib/mock/org/types';
import { MasterTable, PageHeader, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Legal entity name', placeholder: 'e.g. Acme Technologies Pvt Ltd' },
  { name: 'code', label: 'Code', placeholder: 'e.g. IN-LE-01' },
  { name: 'country', label: 'Country', type: 'select', options: ['India', 'United States'] },
  { name: 'registrationNo', label: 'Registration no.', placeholder: 'CIN / EIN' },
  { name: 'head', label: 'Head', placeholder: 'Entity head' },
];

export default function LegalEntitiesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [entities, employees] = await Promise.all([
        orgApi.listLegalEntities(),
        orgApi.listEmployees(),
      ]);
      setRows(
        entities.map((e) => ({
          id: e.id,
          name: e.name,
          // The reference table stores names only — no code/country/head yet.
          code: '—',
          country: '—',
          registrationNo: '—',
          head: '—',
          employees: employees.filter((emp) => emp.legal_entity_id === e.id).length,
          status: 'Active',
        }) as LegalEntity),
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
        <PageHeader title="Legal Entities" subtitle="Loading…" />
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
      <MasterTable<LegalEntity>
        title="Legal Entities"
        subtitle="Live names and headcount from the server; codes and heads are not stored by the backend yet (stub actions)."
        rows={rows}
        fields={fields}
        addLabel="Add legal entity"
        canManage={canManage}
        searchPlaceholder="Search by name, code or country…"
        columns={[
          { key: 'name', label: 'Entity' },
          { key: 'code', label: 'Code' },
          { key: 'country', label: 'Country' },
          { key: 'head', label: 'Head' },
          { key: 'employees', label: 'Employees' },
          { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
        ]}
      />
    </div>
  );
}
