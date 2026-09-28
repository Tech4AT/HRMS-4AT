'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { jobFamilies } from '@/lib/mock/org/phase2';
import type { JobFamily } from '@/lib/mock/org/phase2';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Family name', placeholder: 'e.g. Engineering' },
  { name: 'code', label: 'Code', placeholder: 'e.g. JF-ENG' },
  { name: 'description', label: 'Description', placeholder: 'What roles belong here' },
];

export default function JobFamiliesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<JobFamily>
      title="Job Families"
      subtitle="Top-level groupings — positions roll up to a family (mock data, stub actions)."
      rows={jobFamilies}
      fields={fields}
      addLabel="Add job family"
      canManage={canManage}
      searchPlaceholder="Search by name, code or description…"
      columns={[
        { key: 'name', label: 'Family' },
        { key: 'code', label: 'Code' },
        { key: 'description', label: 'Description' },
        { key: 'titles', label: 'Titles' },
        { key: 'employees', label: 'Employees' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
      ]}
    />
  );
}
