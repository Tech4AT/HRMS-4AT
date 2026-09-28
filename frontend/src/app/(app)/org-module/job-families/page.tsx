'use client';

import { orgApi } from '@/lib/api/org';
import { NamedMasterSection } from '@/components/org-module/named-master-section';

export default function JobFamiliesPage() {
  return (
    <NamedMasterSection
      title="Job Families"
      subtitle="Top-level occupation groupings from the live registry (reads are live; add/edit not yet wired)."
      searchPlaceholder="Search by name…"
      load={orgApi.listJobFamilies}
    />
  );
}
