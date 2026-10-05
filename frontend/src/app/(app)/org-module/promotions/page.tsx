'use client';

import { useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import { OrgChangeSection, type IdOption } from '@/components/org-module/org-change-section';

export default function PromotionsPage() {
  const [designations, setDesignations] = useState<IdOption[]>([]);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [desigs, emps] = await Promise.all([
          orgApi.listDesignations(),
          orgApi.listDirectory(),
        ]);
        if (!cancelled) {
          setDesignations(desigs);
          setDirectory(emps);
        }
      } catch {
        /* section shows its own load error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const desigNames = new Map(designations.map((d) => [d.id, d.name]));
  const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));

  return (
    <OrgChangeSection
      changeType="promotion"
      title="Promotions"
      logLabel="Log promotion"
      toField="designation_id"
      toLabel="To (new title)"
      toOptions={designations}
      currentValue={(e) => e.designation_id}
      resolveName={(id) => desigNames.get(id) ?? empNames.get(id) ?? id}
    />
  );
}
