// Typed client for the Employee 360 profile (`/employees/<id|me>/profile/...`).
// Goes through the whitelisted admin proxy (`/api/admin/employees/...`), which
// forwards to the backend; the backend decides who may see or change what and
// reports it back in `access`, so the UI never guesses from role names.

import { request } from '@/lib/admin/api';

/** What the caller may do on this one profile - render from these, not from roles. */
export interface Employee360Access {
  is_self: boolean;
  can_read_personal: boolean;
  can_edit_personal: boolean;
  can_edit_name: boolean;
}

export interface Employee360Job {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
  employment_type: string;
  date_of_joining: string | null;
  date_of_exit: string | null;
  designation_name: string | null;
  department_name: string | null;
  location_name: string | null;
  legal_entity_name: string | null;
  business_unit_name: string | null;
  cost_center_name: string | null;
  manager: { id: string; name: string } | null;
}

export interface Employee360Personal {
  personal_email: string;
  phone: string;
  dob: string | null;
  gender: string;
}

export interface Employee360Address {
  current_line1: string;
  current_line2: string;
  current_city: string;
  current_state: string;
  current_postal_code: string;
  current_country: string;
  permanent_same_as_current: boolean;
  permanent_line1: string;
  permanent_line2: string;
  permanent_city: string;
  permanent_state: string;
  permanent_postal_code: string;
  permanent_country: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
}

export type EmergencyContactInput = Omit<EmergencyContact, 'id'>;

/** The About card's free-text answers; an empty string means "not answered". */
export interface EmployeeAbout {
  about: string;
  love_about_job: string;
  interests: string;
}

export interface EmployeeSkill {
  id: string;
  name: string;
}

export const ABOUT_MAX_LENGTH = 1000;
export const MAX_SKILLS = 20;
export const SKILL_MAX_LENGTH = 60;

/** Personal sections are `null` when the caller may not read them. About and
 *  skills are not sensitive: anyone who can open the profile sees them. */
export interface Employee360 {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
  access: Employee360Access;
  job: Employee360Job;
  about: EmployeeAbout;
  skills: EmployeeSkill[];
  personal: Employee360Personal | null;
  address: Employee360Address | null;
  emergency_contacts: EmergencyContact[] | null;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  title: string;
  /** ISO date, newest first in the list. */
  date: string | null;
  detail: string | null;
  person: { id: string; name: string } | null;
}

export const MAX_EMERGENCY_CONTACTS = 5;

const base = (id: string) => `employees/${id}/profile/`;

export const employee360Api = {
  get: (id: string) => request<Employee360>(base(id)),
  timeline: (id: string) =>
    request<{ events: TimelineEvent[] }>(`${base(id)}timeline/`).then((r) => r.events),
  updateAbout: (id: string, body: Partial<EmployeeAbout>) =>
    request<Employee360>(`${base(id)}about/`, { method: 'PATCH', body }),
  addSkill: (id: string, name: string) =>
    request<Employee360>(`${base(id)}skills/`, { method: 'POST', body: { name } }),
  removeSkill: (id: string, skillId: string) =>
    request<Employee360>(`${base(id)}skills/${skillId}/`, { method: 'DELETE' }),
  updateName: (id: string, body: { first_name: string; last_name: string }) =>
    request<Employee360>(`${base(id)}name/`, { method: 'PATCH', body }),
  updatePersonal: (id: string, body: Partial<Employee360Personal>) =>
    request<Employee360>(`${base(id)}personal/`, { method: 'PATCH', body }),
  saveAddress: (id: string, body: Partial<Employee360Address>) =>
    request<Employee360>(`${base(id)}address/`, { method: 'PUT', body }),
  addContact: (id: string, body: EmergencyContactInput) =>
    request<Employee360>(`${base(id)}emergency-contacts/`, { method: 'POST', body }),
  updateContact: (id: string, contactId: string, body: Partial<EmergencyContactInput>) =>
    request<Employee360>(`${base(id)}emergency-contacts/${contactId}/`, { method: 'PATCH', body }),
  deleteContact: (id: string, contactId: string) =>
    request<Employee360>(`${base(id)}emergency-contacts/${contactId}/`, { method: 'DELETE' }),
};
