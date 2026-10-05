/** Browser-side reads for My Team's people. Names, titles and departments come
 *  from the company-wide org directory (visible to everyone) and the same
 *  reference lists the Organisation page uses. Which of those people are in a
 *  group, and what may be shown about them today, comes from
 *  `teamAttendanceApi.getSummary`. */

import type { DirectoryPerson } from '@/lib/team/groups';

interface Named {
  id: string;
  name: string;
}

export class MyTeamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MyTeamError';
  }
}

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
    throw new MyTeamError(body?.error?.message || `Request to ${url} failed`, res.status);
  }
  return body.data as T;
}

const toMap = (items: Named[]): Record<string, string> =>
  Object.fromEntries(items.map((i) => [String(i.id), i.name]));

export interface MyTeamData {
  people: DirectoryPerson[];
  departments: Record<string, string>;
  designations: Record<string, string>;
  locations: Record<string, string>;
  businessUnits: Record<string, string>;
  legalEntities: Record<string, string>;
}

export const myTeamApi = {
  load: async (): Promise<MyTeamData> => {
    const [people, departments, designations, locations, businessUnits, legalEntities] = await Promise.all([
      fetchData<DirectoryPerson[]>('/api/org-directory'),
      fetchData<Named[]>('/api/departments'),
      fetchData<Named[]>('/api/designations'),
      fetchData<Named[]>('/api/locations'),
      fetchData<Named[]>('/api/business-units'),
      fetchData<Named[]>('/api/legal-entities'),
    ]);
    return {
      people,
      departments: toMap(departments),
      designations: toMap(designations),
      locations: toMap(locations),
      businessUnits: toMap(businessUnits),
      legalEntities: toMap(legalEntities),
    };
  },
};
