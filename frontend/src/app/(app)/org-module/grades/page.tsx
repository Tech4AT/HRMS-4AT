'use client';

import { orgApi } from '@/lib/api/org';
import { NamedMasterSection } from '@/components/org-module/named-master-section';

export default function GradesPage() {
  return (
    <NamedMasterSection
      title="Grades / Bands"
      subtitle="Compensation bands attached to levels, from the live registry (reads are live; add/edit not yet wired)."
      searchPlaceholder="Search by name…"
      load={orgApi.listGrades}
    />
  );
}
