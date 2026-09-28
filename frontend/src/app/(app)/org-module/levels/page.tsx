'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { levels } from '@/lib/mock/org/phase2';
import type { Level } from '@/lib/mock/org/phase2';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Level code', placeholder: 'e.g. L3' },
  { name: 'title', label: 'Level title', placeholder: 'e.g. Senior' },
  { name: 'experience', label: 'Experience range', placeholder: 'e.g. 3–6 yrs' },
  { name: 'description', label: 'Description', placeholder: 'What this level means' },
];

export default function LevelsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<Level>
      title="Levels"
      subtitle="Career ladder shared across families, L1–L7 (mock data, stub actions)."
      rows={levels}
      fields={fields}
      addLabel="Add level"
      canManage={canManage}
      searchPlaceholder="Search by code, title or experience…"
      columns={[
        { key: 'name', label: 'Level' },
        { key: 'title', label: 'Title' },
        { key: 'experience', label: 'Experience' },
        { key: 'description', label: 'Description' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
      ]}
    />
  );
}
