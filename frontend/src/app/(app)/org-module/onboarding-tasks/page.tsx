'use client';

import { useAuth } from '@/lib/auth/useAuth';
import { taskTemplates } from '@/lib/mock/org/phase3';
import type { TaskTemplate } from '@/lib/mock/org/phase3';
import { MasterTable, StatusPill, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'name', label: 'Template name', placeholder: 'e.g. Day-one HR checklist' },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    options: ['HR', 'Manager', 'IT', 'Finance', 'Employee'],
  },
  { name: 'ownerRole', label: 'Owner role', placeholder: 'e.g. HR Partner' },
  { name: 'dueOffset', label: 'Due offset', placeholder: 'e.g. Day 1' },
];

export default function OnboardingTasksPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  return (
    <MasterTable<TaskTemplate>
      title="Tasks / Templates"
      subtitle="Reusable onboarding checklists and task templates by owner category (mock data, stub actions)."
      rows={taskTemplates}
      fields={fields}
      addLabel="Add template"
      canManage={canManage}
      searchPlaceholder="Search by name, category or owner…"
      columns={[
        { key: 'name', label: 'Template' },
        { key: 'category', label: 'Category', render: (r) => <StatusPill value={r.category} /> },
        { key: 'tasks', label: 'Tasks' },
        { key: 'ownerRole', label: 'Owner role' },
        { key: 'dueOffset', label: 'Due' },
      ]}
    />
  );
}
