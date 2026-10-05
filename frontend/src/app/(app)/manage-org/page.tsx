'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { EmployeesTab } from '@/components/admin/org/EmployeesTab';
import { EmployeeDrawer } from '@/components/admin/org/EmployeeDrawer';
import { StructureTab } from '@/components/admin/org/StructureTab';
import { OrgChartTab } from '@/components/admin/org/OrgChartTab';
import { useOrgData } from '@/components/admin/org/useOrgData';
import { Notice } from '@/components/admin/ui';

type TabId = 'employees' | 'structure' | 'chart';

function ManageOrganisation() {
  const { user, isLoading, hasPermission } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { employees, lookups, loading, error, reloadEmployees, reloadLookups } = useOrgData();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noManagerOnly, setNoManagerOnly] = useState(false);

  const canWrite = hasPermission('employees.write');
  // A Manager can reassign reporting lines in their team without being able to edit
  // anything else about people.
  const canEditReportingLine = hasPermission('employees.reporting_line.write');
  const canStructure = hasPermission('org.manage');
  const hasAccess = canWrite || canStructure || canEditReportingLine;

  useEffect(() => {
    if (!isLoading && (!user || !hasAccess)) router.push('/');
  }, [isLoading, user, hasAccess, router]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'employees', label: 'Employees' },
    ...(canStructure ? [{ id: 'structure' as TabId, label: 'Organisation structure' }] : []),
    { id: 'chart', label: 'Reporting lines' },
  ];
  const requested = searchParams.get('tab') as TabId | null;
  const tab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : 'employees';
  const goto = (id: TabId) => router.replace(`/manage-org?tab=${id}`);

  if (isLoading || !hasAccess) return null;

  const selectedEmployee = selected && selected !== 'new' ? employees.find((e) => e.id === selected) ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-8">
        <div className="flex gap-5 overflow-x-auto scrollbar-hide" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => goto(t.id)}
              className={`px-1 py-3 border-b-2 font-semibold whitespace-nowrap transition-colors ${
                tab === t.id ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-8">
        {notice && (
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex-1">
              <Notice tone="success">{notice}</Notice>
            </div>
            <button className="text-sm text-gray-500 hover:text-gray-900" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {tab === 'employees' && (
          <EmployeesTab
            employees={employees}
            lookups={lookups}
            loading={loading}
            error={error}
            canWrite={canWrite}
            onOpen={setSelected}
            noManagerOnly={noManagerOnly}
            onNoManagerOnly={setNoManagerOnly}
          />
        )}
        {tab === 'structure' && canStructure && (
          <StructureTab
            onChanged={() => {
              reloadLookups();
              reloadEmployees();
            }}
          />
        )}
        {tab === 'chart' && (
          <OrgChartTab
            employees={employees}
            lookups={lookups}
            onOpen={setSelected}
            onShowUnmanaged={() => {
              setNoManagerOnly(true);
              goto('employees');
            }}
          />
        )}
      </div>

      {selected && (selected === 'new' || selectedEmployee) && (
        <EmployeeDrawer
          key={selected}
          employee={selectedEmployee}
          employees={employees}
          lookups={lookups}
          canWrite={canWrite}
          canEditReportingLine={canEditReportingLine}
          onClose={() => setSelected(null)}
          onSaved={async (_saved, message) => {
            await reloadEmployees();
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

export default function ManageOrganisationPage() {
  return (
    <Suspense fallback={null}>
      <ManageOrganisation />
    </Suspense>
  );
}
