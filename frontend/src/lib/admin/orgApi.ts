// Typed client for managing employees and the organisation structure. Uses the
// same whitelisted proxy as the access-control screens (/api/admin/...).

import { request, qs } from './api';

export type EmployeeStatus = 'active' | 'on_leave' | 'exited';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  exited: 'Left',
};

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
];

export type WorkMode = 'office' | 'remote' | 'hybrid';

export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'office', label: 'Office' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
];

export const GENDERS = [
  { value: '', label: 'Not recorded' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/** The directory record, exactly as the backend sends it (snake_case, string ids). */
export interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  department_id: string | null;
  designation_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  legal_entity_id: string | null;
  business_unit_id: string | null;
  cost_center_id: string | null;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  date_of_joining: string | null;
  date_of_exit: string | null;
}

export interface PersonalDetails {
  personal_email: string;
  phone: string;
  dob: string | null;
  gender: string;
  exit_reason: string;
}

/** What may be sent when creating or editing an employee. */
export interface EmployeeInput {
  first_name?: string;
  last_name?: string;
  work_email?: string;
  employee_code?: string;
  department_id?: string | null;
  designation_id?: string | null;
  location_id?: string | null;
  legal_entity_id?: string | null;
  business_unit_id?: string | null;
  cost_center_id?: string | null;
  manager_id?: string | null;
  employment_type?: EmploymentType;
  work_mode?: WorkMode;
  date_of_joining?: string | null;
  status?: EmployeeStatus;
  date_of_exit?: string | null;
  exit_reason?: string;
}

export type OrgKind =
  | 'departments'
  | 'designations'
  | 'locations'
  | 'legal-entities'
  | 'business-units'
  | 'cost-centers';

export const ORG_KINDS: { kind: OrgKind; label: string; singular: string; field: keyof EmployeeRow }[] = [
  { kind: 'departments', label: 'Departments', singular: 'department', field: 'department_id' },
  { kind: 'designations', label: 'Job titles', singular: 'job title', field: 'designation_id' },
  { kind: 'locations', label: 'Locations', singular: 'location', field: 'location_id' },
  { kind: 'legal-entities', label: 'Legal entities', singular: 'legal entity', field: 'legal_entity_id' },
  { kind: 'business-units', label: 'Business units', singular: 'business unit', field: 'business_unit_id' },
  { kind: 'cost-centers', label: 'Cost centres', singular: 'cost centre', field: 'cost_center_id' },
];

export interface OrgUnit {
  id: number;
  name: string;
  isActive: boolean;
  employeeCount: number;
  createdAt: string;
  code?: string;
  parent?: number | null;
  parentName?: string | null;
  childCount?: number;
}

interface Page<T> {
  results: T[];
  total: number;
}

export const orgApi = {
  // employees (snake_case)
  listEmployees: (p: { search?: string; department?: string; location?: string; status?: string; no_manager?: string } = {}) =>
    request<EmployeeRow[]>(`employees/${qs(p)}`),
  createEmployee: (body: EmployeeInput) => request<EmployeeRow>('employees/', { method: 'POST', body }),
  updateEmployee: (id: string, body: EmployeeInput) =>
    request<EmployeeRow>(`employees/${id}/`, { method: 'PATCH', body }),
  getPersonal: (id: string) => request<PersonalDetails>(`employees/${id}/personal/`),
  updatePersonal: (id: string, body: Partial<PersonalDetails>) =>
    request<PersonalDetails>(`employees/${id}/personal/`, { method: 'PATCH', body }),

  // organisation structure (camelCase, paginated)
  listUnits: async (kind: OrgKind, search?: string) =>
    (await request<Page<OrgUnit>>(`org/${kind}/${qs({ pageSize: 100, search })}`)).results,
  createUnit: (kind: OrgKind, body: { name: string; code?: string; parent?: number | null }) =>
    request<OrgUnit>(`org/${kind}/`, { method: 'POST', body }),
  updateUnit: (
    kind: OrgKind,
    id: number,
    body: Partial<{ name: string; code: string; parent: number | null; isActive: boolean }>,
  ) => request<OrgUnit>(`org/${kind}/${id}/`, { method: 'PATCH', body }),
  deleteUnit: (kind: OrgKind, id: number) => request<void>(`org/${kind}/${id}/`, { method: 'DELETE' }),
};

export function fullName(e: Pick<EmployeeRow, 'first_name' | 'last_name'>): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
