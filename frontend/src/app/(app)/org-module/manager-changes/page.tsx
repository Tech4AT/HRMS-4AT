'use client';

import { useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import { OrgChangeSection, type IdOption } from '@/components/org-module/org-change-section';

export default function ManagerChangesPage() {
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emps = await orgApi.listDirectory();
        if (!cancelled) setDirectory(emps);
      } catch {
        /* section shows its own load error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options: IdOption[] = directory.map((e) => ({ id: e.id, name: `${fullName(e)} (${e.employee_code})` }));
  const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));

  return (
    <OrgChangeSection
      changeType="manager_change"
      title="Manager Changes"
      subtitle="Reporting-line moves with effective dates (live from the org-changes log)."
      logLabel="Log manager change"
      toField="manager_id"
      toLabel="To (new manager)"
      toOptions={options}
      currentValue={(e) => e.manager_id}
      resolveName={(id) => empNames.get(id) ?? id}
    />
  );
}
