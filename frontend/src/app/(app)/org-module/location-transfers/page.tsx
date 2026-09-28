'use client';

import { useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import { OrgChangeSection, type IdOption } from '@/components/org-module/org-change-section';

export default function LocationTransfersPage() {
  const [locations, setLocations] = useState<IdOption[]>([]);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locs, emps] = await Promise.all([
          orgApi.listLocations(),
          orgApi.listDirectory(),
        ]);
        if (!cancelled) {
          setLocations(locs);
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

  const locNames = new Map(locations.map((l) => [l.id, l.name]));
  const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));

  return (
    <OrgChangeSection
      changeType="location_transfer"
      title="Location Transfers"
      logLabel="Log transfer"
      toField="location_id"
      toLabel="To (location)"
      toOptions={locations}
      currentValue={(e) => e.location_id}
      resolveName={(id) => locNames.get(id) ?? empNames.get(id) ?? id}
    />
  );
}
