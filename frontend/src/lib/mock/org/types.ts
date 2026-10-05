/** ORG module mock types — FRONTEND ONLY, no backend. */

export type MasterStatus = 'Active' | 'Inactive';

export interface LegalEntity {
  id: string;
  name: string;
  code: string;
  country: string;
  registrationNo: string;
  head: string;
  employees: number;
  status: MasterStatus;
}

export interface BusinessUnit {
  id: string;
  name: string;
  code: string;
  legalEntity: string;
  head: string;
  employees: number;
  status: MasterStatus;
}

export interface OrgLocation {
  id: string;
  name: string;
  code: string;
  city: string;
  country: string;
  employees: number;
  status: MasterStatus;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  /** Parent business unit (hierarchy-aware). */
  parent: string;
  head: string;
  teams: number;
  employees: number;
  status: MasterStatus;
}

export interface Team {
  id: string;
  name: string;
  code: string;
  /** Parent department (hierarchy-aware). */
  department: string;
  lead: string;
  members: number;
  status: MasterStatus;
}

export type PositionStatus = 'Filled' | 'Vacant' | 'Hiring' | 'On Hold';

export interface PositionSummary {
  status: PositionStatus;
  count: number;
}

export interface HeadcountByDepartment {
  department: string;
  headcount: number;
}

export interface LocationSummary {
  location: string;
  headcount: number;
}

export interface OrgChange {
  id: string;
  type: string;
  subject: string;
  from: string;
  to: string;
  effectiveDate: string;
  changedBy: string;
  status: 'Completed' | 'Pending' | 'Scheduled';
}
