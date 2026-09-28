'use client';

import { orgApi } from '@/lib/api/org';
import { NamedMasterSection } from '@/components/org-module/named-master-section';

export default function JobFamiliesPage() {
  return (
    <NamedMasterSection
      title="Job Families"
      searchPlaceholder="Search by name…"
      load={orgApi.listJobFamilies}
    />
  );
}
