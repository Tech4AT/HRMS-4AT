'use client';

import { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DocumentTemplatesTab } from './DocumentTemplatesTab';
import { EmployeeDocumentsTab } from './EmployeeDocumentsTab';
import { OrganizationDocumentsTab } from './OrganizationDocumentsTab';

const TABS = [
  { key: 'templates', label: 'Document Templates' },
  { key: 'employee', label: 'Employee Documents' },
  { key: 'org', label: 'Organization Documents' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Org > Documents (Keka layout): three top tabs, selected via ?dtab=. The
 * Verified Documents sub-tab reuses the live per-employee file store, passed
 * in by the org page as `verified`. */
export function OrgDocumentsSection({ verified }: { verified: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('dtab');
  const active: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : 'templates';

  const go = (key: TabKey) => {
    const p = new URLSearchParams(params.toString());
    p.set('tab', 'documents');
    p.set('dtab', key);
    p.delete('sub');
    router.replace(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-6 border-b border-gray-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => go(t.key)}
            className={`pb-3 -mb-px text-sm font-medium border-b-2 ${
              active === t.key
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active === 'templates' && <DocumentTemplatesTab />}
      {active === 'employee' && <EmployeeDocumentsTab verified={verified} />}
      {active === 'org' && <OrganizationDocumentsTab />}
    </div>
  );
}
