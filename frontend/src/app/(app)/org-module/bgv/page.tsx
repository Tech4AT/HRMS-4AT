'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { bgvCases } from '@/lib/mock/org/phase3';
import type { BgvCase } from '@/lib/mock/org/phase3';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'candidate', label: 'Candidate name', placeholder: 'e.g. Ananya Rao' },
  {
    name: 'vendor',
    label: 'Vendor',
    type: 'select',
    options: ['VeriCheck Solutions', 'TrustScreen India'],
  },
  { name: 'initiated', label: 'Initiated on', placeholder: 'YYYY-MM-DD' },
];

export default function BgvPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<BgvCase>
      title="Background Verification"
      subtitle="Verification cases: initiation, vendor status and completion (mock data, stub actions)."
      rows={bgvCases}
      fields={fields}
      addLabel="Initiate BGV"
      canManage={canManage}
      searchPlaceholder="Search by candidate or vendor…"
      columns={[
        { key: 'candidate', label: 'Candidate' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'initiated', label: 'Initiated' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
        { key: 'result', label: 'Result', render: (r) => <StatusPill value={r.result} /> },
        { key: 'completed', label: 'Completed' },
      ]}
    />
  );
}
