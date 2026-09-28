'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { grades } from '@/lib/mock/org/phase2';
import type { Grade } from '@/lib/mock/org/phase2';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'band', label: 'Band', placeholder: 'e.g. G3' },
  {
    name: 'level',
    label: 'Level',
    type: 'select',
    options: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
  },
  { name: 'minSalary', label: 'Min salary', placeholder: 'e.g. ₹10,00,000' },
  { name: 'maxSalary', label: 'Max salary', placeholder: 'e.g. ₹16,00,000' },
  { name: 'effectiveDate', label: 'Effective date', placeholder: 'e.g. 2026-04-01' },
];

export default function GradesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<Grade>
      title="Grades / Bands"
      subtitle="Compensation bands attached to levels (mock data, stub actions)."
      rows={grades}
      fields={fields}
      addLabel="Add grade / band"
      canManage={canManage}
      searchPlaceholder="Search by band, level or salary…"
      columns={[
        { key: 'band', label: 'Band' },
        { key: 'level', label: 'Level' },
        { key: 'minSalary', label: 'Min salary' },
        { key: 'maxSalary', label: 'Max salary' },
        { key: 'currency', label: 'Currency' },
        { key: 'effectiveDate', label: 'Effective' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
      ]}
    />
  );
}
