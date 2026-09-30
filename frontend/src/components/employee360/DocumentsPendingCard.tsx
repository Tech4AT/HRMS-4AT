'use client';

import type { ReactNode } from 'react';
import { EmptyNote, SectionCard } from './parts';

/** Education, identity documents and bank details are submitted and verified
 *  through the onboarding documents flow, not edited on the profile. Until that
 *  is connected these sections say so instead of showing made-up values. */
export function DocumentsPendingCard({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <SectionCard title={title} icon={icon}>
      <EmptyNote>
        Submitted and verified through onboarding documents. It will appear here once that is connected.
      </EmptyNote>
    </SectionCard>
  );
}
