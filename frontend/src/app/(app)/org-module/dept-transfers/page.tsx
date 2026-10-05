'use client';

import { useEffect, useState } from 'react';
import { fullName, orgApi, type OrgEmployee } from '@/lib/api/org';
import { OrgChangeSection, type IdOption } from '@/components/org-module/org-change-section';

export default function DeptTransfersPage() {
  const [departments, setDepartments] = useState<IdOption[]>([]);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [depts, emps] = await Promise.all([
          orgApi.listDepartments(),
          orgApi.listDirectory(),
        ]);
        if (!cancelled) {
          setDepartments(depts);
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

  const deptNames = new Map(departments.map((d) => [d.id, d.name]));
  const empNames = new Map(directory.map((e) => [e.id, fullName(e)]));

  return (
    <OrgChangeSection
      changeType="dept_transfer"
      title="Department Transfers"
      logLabel="Log transfer"
      toField="department_id"
      toLabel="To (department)"
      toOptions={departments}
      currentValue={(e) => e.department_id}
      resolveName={(id) => deptNames.get(id) ?? empNames.get(id) ?? id}
    />
  );
}
