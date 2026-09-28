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
  },
  {
    href: '/org?tab=chart',
    title: 'Organisation Chart',
  },
  {
    href: '/employees',
    title: 'All Employees (admin)',
  },
  {
    href: '/manage-org',
    title: 'Manage Structure (admin)',
  },
];

export default function OrgEmployeesPage() {
  return (
    <div>
      <PageHeader title="Employees" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {links.map((l) => (
          <Link
            key={l.href + l.title}
            href={l.href}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <p className="text-sm font-bold text-slate-900">{l.title}</p>
            <p className="mt-3 text-xs font-semibold text-indigo-600">Open →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
