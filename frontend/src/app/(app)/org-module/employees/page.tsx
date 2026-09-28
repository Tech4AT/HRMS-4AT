import Link from 'next/link';
import { PageHeader } from '@/components/org-module/ui';

/**
 * Employees section — REUSES the existing directory + org tree at /org
 * (and the admin pieces under components/admin/org/*) instead of rebuilding.
 */
const links = [
  {
    href: '/org?tab=directory',
    title: 'Employee Directory',
    body: 'Search and filter every employee by business unit, department, location and cost center.',
  },
  {
    href: '/org?tab=chart',
    title: 'Organisation Tree',
    body: 'Expand and collapse reporting lines, jump to your department or yourself, export the chart.',
  },
  {
    href: '/employees',
    title: 'All Employees (admin)',
    body: 'Full employee records for HR administrators with org-wide scope.',
  },
  {
    href: '/manage-org',
    title: 'Manage Structure (admin)',
    body: 'Employees, reporting lines and the organisation structure (needs employees.write or org.manage).',
  },
];

export default function OrgEmployeesPage() {
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="The directory and org tree already exist — this section links to them instead of rebuilding."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {links.map((l) => (
          <Link
            key={l.href + l.title}
            href={l.href}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <p className="text-sm font-bold text-slate-900">{l.title}</p>
            <p className="text-sm text-slate-500 mt-1">{l.body}</p>
            <p className="mt-3 text-xs font-semibold text-indigo-600">Open →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
