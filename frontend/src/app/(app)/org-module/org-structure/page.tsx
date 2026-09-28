'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrgStructureScreen } from '@/components/org-module/org-structure-screen';

function ScreenWithTab() {
  const params = useSearchParams();
  return <OrgStructureScreen initialTab={params.get('tab') ?? undefined} />;
}

export default function OrgStructurePage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
          <div className="h-5 w-1/3 bg-slate-100 rounded" />
        </div>
      }
    >
      <ScreenWithTab />
    </Suspense>
  );
}
