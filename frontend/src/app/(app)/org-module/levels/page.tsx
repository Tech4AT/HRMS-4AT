'use client';

import { orgApi } from '@/lib/api/org';
import { NamedMasterSection } from '@/components/org-module/named-master-section';

export default function LevelsPage() {
  return (
    <NamedMasterSection
      title="Levels"
      subtitle="Seniority rungs shared across families, from the live registry (reads are live; add/edit not yet wired)."
      searchPlaceholder="Search by name…"
      load={orgApi.listLevels}
    />
  );
}
