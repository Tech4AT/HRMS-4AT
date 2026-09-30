/** The directory row My Team shows for a person. Who is in a group (direct
 *  reports, indirect reports, peers) is decided by the backend, not here: it
 *  reuses the same reporting-line rules as access control, so a group can never
 *  disagree with what the caller is allowed to see. */

export interface DirectoryPerson {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  department_id: string | null;
  designation_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  status: string;
  // Also part of the directory row; used by the member details panel.
  business_unit_id?: string | null;
  legal_entity_id?: string | null;
  employment_type?: string;
  date_of_joining?: string | null;
}

export function fullName(p: Pick<DirectoryPerson, 'first_name' | 'last_name' | 'work_email'>): string {
  return `${p.first_name} ${p.last_name}`.trim() || p.work_email;
}
