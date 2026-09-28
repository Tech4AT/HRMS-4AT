'use client';

import { useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import { OrgChangeSection, type IdOption } from '@/components/org-module/org-change-section';

export default function PositionChangesPage() {
  const [positions, setPositions] = useState<IdOption[]>([]);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [poss, emps] = await Promise.all([
          orgApi.listPositions(),
          orgApi.listDirectory(),
        ]);
        if (!cancelled) {
          setPositions(poss.map((p) => ({ id: p.id, name: p.name || `Position ${p.id.slice(0, 8)}` })));
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

  const posNames = new Map(positions.map((p) => [p.id, p.name]));
  const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));

  return (
    <OrgChangeSection
      changeType="position_change"
      title="Position Changes"
      subtitle="Moves between approved seats with effective dates (live from the org-changes log)."
      logLabel="Log position change"
      toField="position_id"
      toLabel="To (position)"
      toOptions={positions}
      currentValue={() => null}
      resolveName={(id) => posNames.get(id) ?? empNames.get(id) ?? id}
    />
  );
}
