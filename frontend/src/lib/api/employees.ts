/**
 * Minimal browser-side read client for the real employee directory
 * (`/api/employees`, `/api/departments` — already real, org-scoped backends).
 * Kept small and specific to what a picker/assignment UI needs (id, display
 * name, department label) rather than importing the richer shape
 * `(app)/employees/page.tsx` uses for the full directory page.
 */

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export interface DirectoryEmployee {
  id: string;
  name: string;
  /** Department name, or "Unassigned" if the employee has none set. */
  department: string;
  departmentId: string | null;
}

interface RawEmployee {
  id: string;
  first_name: string;
  last_name: string;
  department_id?: string | null;
}

interface NamedEntity {
  id: string;
  name: string;
}

/** The caller's own visible scope (self/team/org, resolved server-side per
 *  their permission) — same endpoints the org-wide directory page uses. */
export async function getEmployeeDirectory(): Promise<DirectoryEmployee[]> {
  const [employees, departments] = await Promise.all([
    fetchJson<RawEmployee[]>('/api/employees'),
    fetchJson<NamedEntity[]>('/api/departments'),
  ]);
  const departmentNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));
  return employees.map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
    department: (e.department_id && departmentNames[e.department_id]) || 'Unassigned',
    departmentId: e.department_id ?? null,
  }));
}

export async function getDepartments(): Promise<{ id: string; name: string }[]> {
  return fetchJson<NamedEntity[]>('/api/departments');
}
