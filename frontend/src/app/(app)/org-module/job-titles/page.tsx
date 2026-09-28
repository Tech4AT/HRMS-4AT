'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { jobTitles } from '@/lib/mock/org/phase2';
import type { JobTitle } from '@/lib/mock/org/phase2';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'title', label: 'Title / designation', placeholder: 'e.g. Senior Software Engineer' },
  { name: 'code', label: 'Code', placeholder: 'e.g. JT-SSE' },
  {
    name: 'family',
    label: 'Job family',
    type: 'select',
    options: ['Engineering', 'Design', 'Consulting', 'Finance', 'People', 'Management', 'Data & AI'],
  },
  {
    name: 'level',
    label: 'Level',
    type: 'select',
    options: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
  },
];

export default function JobTitlesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<JobTitle>
      title="Job Titles / Designations"
      subtitle="Master list of designations used across positions (mock data, stub actions)."
      rows={jobTitles}
      fields={fields}
      addLabel="Add job title"
      canManage={canManage}
      searchPlaceholder="Search by title, code, family or level…"
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'code', label: 'Code' },
        { key: 'family', label: 'Family' },
        { key: 'level', label: 'Level' },
        { key: 'positions', label: 'Positions' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
      ]}
    />
  );
}
