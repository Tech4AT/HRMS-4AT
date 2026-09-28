'use client';

import { useEffect, useState } from 'react';
import { orgApi } from '@/lib/api/org';
import { NamedMasterSection } from '@/components/org-module/named-master-section';

/**
 * There is no separate job-title registry on the backend — designations are
 * the title master (positions point at them via job_title). This page reads
 * the live designations and counts live positions per title.
 */
export default function JobTitlesPage() {
  const [counts, setCounts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const poss = await orgApi.listPositions();
        const m = new Map<string, number>();
        for (const p of poss) {
          if (p.job_title_id) m.set(p.job_title_id, (m.get(p.job_title_id) ?? 0) + 1);
        }
        if (!cancelled) {
          const out: Record<string, string> = {};
          for (const [id, n] of m) out[id] = String(n);
          setCounts(out);
        }
      } catch {
        /* table shows its own load error; counts stay blank */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <NamedMasterSection
      title="Job Titles / Designations"
      searchPlaceholder="Search by title…"
      load={orgApi.listDesignations}
      extraColumns={[{ key: 'positions', label: 'Positions' }]}
      extraValues={(id) => ({ positions: counts[id] ?? '0' })}
    />
  );
}
