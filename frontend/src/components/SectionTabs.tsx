'use client';

import { useRouter } from 'next/navigation';

export interface SectionTab {
  id: string;
  label: string;
  href: string;
}

/** Shared in-page tab strip used by the Attendance & Leave section's three
 *  groups (My Attendance, Approvals, Settings). Navigates via router.push;
 *  the active tab is matched by id, not by the current pathname, since some
 *  groups (Approvals, Settings) select their tab via a query param rather
 *  than a distinct route. */
export function SectionTabs({ tabs, active }: { tabs: SectionTab[]; active: string }) {
  const router = useRouter();

  return (
    <div className="bg-white border-b border-gray-200 px-4 sm:px-8">
      <div className="flex gap-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => router.push(tab.href)}
            className={`shrink-0 px-1 py-3 border-b-2 font-semibold text-sm transition-colors ${
              active === tab.id
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
