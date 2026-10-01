'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { type EmployeeRow } from '@/lib/admin/orgApi';
import type { Lookups, Named } from '@/components/admin/org/useOrgData';
import { EmployeeDrawer } from '@/components/admin/org/EmployeeDrawer';
import { Notice } from '@/components/admin/ui';
import { EditIcon } from '@/components/icons';
import { Employee360 } from '@/components/employee360/Employee360';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

async function fetchNamed(url: string): Promise<Named[]> {
  const items = await fetchJson<{ id: number | string; name: string }[]>(url);
  return items.map((e) => ({ id: String(e.id), name: e.name }));
}

interface EditData {
  employee: EmployeeRow;
  employees: EmployeeRow[];
  lookups: Lookups;
}

/** Someone else's profile (or your own, opened from the directory). The
 *  profile itself is the shared Employee 360; this page adds the way back to
 *  the directory and HR's edit drawer for job fields. */
export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('employees.write');
  // A Manager may change who someone in their team reports to, and nothing else.
  const canEditReportingLine = hasPermission('employees.reporting_line.write');

  const [editData, setEditData] = useState<EditData | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The drawer needs the directory and the reference lists; fetch them only
  // when someone actually opens it.
  const openEditor = async () => {
    setLoadingEdit(true);
    setEditError(null);
    try {
      const [employee, employees, departments, designations, locations, legalEntities, businessUnits, costCenters] =
        await Promise.all([
          fetchJson<EmployeeRow>(`/api/employees/${id}`),
          fetchJson<EmployeeRow[]>('/api/employees'),
          fetchNamed('/api/departments'),
          fetchNamed('/api/designations'),
          fetchNamed('/api/locations'),
          fetchNamed('/api/legal-entities'),
          fetchNamed('/api/business-units'),
          fetchNamed('/api/cost-centers'),
        ]);
      setEditData({
        employee,
        employees,
        lookups: { departments, designations, locations, legalEntities, businessUnits, costCenters },
      });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not open the editor.');
    } finally {
      setLoadingEdit(false);
    }
  };

  const headerActions = canWrite || canEditReportingLine ? (
    <button
      onClick={openEditor}
      disabled={loadingEdit}
      className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm shrink-0"
    >
      <EditIcon className="w-4 h-4" />
      {loadingEdit ? 'Opening…' : canWrite ? 'Edit employee' : 'Change reporting line'}
    </button>
  ) : null;

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <div className="px-4 sm:px-8 pt-4 space-y-3">
        <Link href="/org?tab=directory" className="inline-block text-sm font-semibold text-blue-700 hover:underline">
          ← Back to directory
        </Link>

        {notice && (
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Notice tone="success">{notice}</Notice>
            </div>
            <button className="text-sm text-gray-500 hover:text-gray-900 shrink-0 pt-2" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {editError && <Notice tone="error">{editError}</Notice>}
      </div>

      <Employee360 employeeId={id} headerActions={headerActions} reloadKey={reloadKey} />

      {editData && (
        <EmployeeDrawer
          key={editData.employee.id}
          employee={editData.employee}
          employees={editData.employees}
          lookups={editData.lookups}
          canWrite={canWrite}
          canEditReportingLine={canEditReportingLine}
          onClose={() => setEditData(null)}
          onSaved={(saved, message) => {
            setEditData((d) => (d ? { ...d, employee: saved } : d));
            setNotice(message);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
