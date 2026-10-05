/**
 * ORG module MOCK data — FRONTEND ONLY. No persistence, no network.
 * The Overview dashboard reads the same master data the structure
 * screens use (per docs/ORG-MODULE-UI.md dev note).
 */
import type {
  BusinessUnit,
  Department,
  HeadcountByDepartment,
  LegalEntity,
  LocationSummary,
  OrgChange,
  OrgLocation,
  PositionSummary,
  Team,
} from './types';

export const legalEntities: LegalEntity[] = [
  {
    id: 'le-1',
    name: 'Acme Technologies Pvt Ltd',
    code: 'IN-LE-01',
    country: 'India',
    registrationNo: 'CIN U72900KA2019PTC123456',
    head: 'Priya Nair',
    employees: 79,
    status: 'Active',
  },
  {
    id: 'le-2',
    name: 'Acme Inc',
    code: 'US-LE-01',
    country: 'United States',
    registrationNo: 'EIN 12-3456789',
    head: 'Daniel Cole',
    employees: 10,
    status: 'Active',
  },
];

export const businessUnits: BusinessUnit[] = [
  {
    id: 'bu-1',
    name: 'Product & Engineering',
    code: 'BU-PRD',
    legalEntity: 'Acme Technologies Pvt Ltd',
    head: 'Arjun Mehta',
    employees: 54,
    status: 'Active',
  },
  {
    id: 'bu-2',
    name: 'Consulting Services',
    code: 'BU-CON',
    legalEntity: 'Acme Technologies Pvt Ltd',
    head: 'Sara Thomas',
    employees: 15,
    status: 'Active',
  },
  {
    id: 'bu-3',
    name: 'Corporate',
    code: 'BU-COR',
    legalEntity: 'Acme Inc',
    head: 'Daniel Cole',
    employees: 20,
    status: 'Active',
  },
];

export const locations: OrgLocation[] = [
  {
    id: 'loc-1',
    name: 'Bengaluru HQ',
    code: 'BLR-HQ',
    city: 'Bengaluru',
    country: 'India',
    employees: 45,
    status: 'Active',
  },
  {
    id: 'loc-2',
    name: 'Mumbai Office',
    code: 'BOM-01',
    city: 'Mumbai',
    country: 'India',
    employees: 18,
    status: 'Active',
  },
  {
    id: 'loc-3',
    name: 'Remote (India)',
    code: 'REM-IN',
    city: 'Remote',
    country: 'India',
    employees: 16,
    status: 'Active',
  },
  {
    id: 'loc-4',
    name: 'New York Office',
    code: 'NYC-01',
    city: 'New York',
    country: 'United States',
    employees: 10,
    status: 'Active',
  },
];

export const departments: Department[] = [
  {
    id: 'dept-1',
    name: 'Engineering',
    code: 'DEPT-ENG',
    parent: 'Product & Engineering',
    head: 'Arjun Mehta',
    teams: 2,
    employees: 42,
    status: 'Active',
  },
  {
    id: 'dept-2',
    name: 'Design',
    code: 'DEPT-DES',
    parent: 'Product & Engineering',
    head: 'Meera Krishnan',
    teams: 1,
    employees: 12,
    status: 'Active',
  },
  {
    id: 'dept-3',
    name: 'Consulting',
    code: 'DEPT-CON',
    parent: 'Consulting Services',
    head: 'Sara Thomas',
    teams: 1,
    employees: 15,
    status: 'Active',
  },
  {
    id: 'dept-4',
    name: 'Finance',
    code: 'DEPT-FIN',
    parent: 'Corporate',
    head: 'Rohan Iyer',
    teams: 1,
    employees: 9,
    status: 'Active',
  },
  {
    id: 'dept-5',
    name: 'People',
    code: 'DEPT-PPL',
    parent: 'Corporate',
    head: 'Divya Rao',
    teams: 1,
    employees: 7,
    status: 'Active',
  },
  {
    id: 'dept-6',
    name: 'Management',
    code: 'DEPT-MGT',
    parent: 'Corporate',
    head: 'Priya Nair',
    teams: 0,
    employees: 4,
    status: 'Active',
  },
];

export const teams: Team[] = [
  {
    id: 'team-1',
    name: 'Platform',
    code: 'TEAM-PLT',
    department: 'Engineering',
    lead: 'Kiran Shah',
    members: 24,
    status: 'Active',
  },
  {
    id: 'team-2',
    name: 'Mobile',
    code: 'TEAM-MOB',
    department: 'Engineering',
    lead: 'Anita Desai',
    members: 18,
    status: 'Active',
  },
  {
    id: 'team-3',
    name: 'Brand',
    code: 'TEAM-BRD',
    department: 'Design',
    lead: 'Meera Krishnan',
    members: 12,
    status: 'Active',
  },
  {
    id: 'team-4',
    name: 'Enterprise Consulting',
    code: 'TEAM-ENC',
    department: 'Consulting',
    lead: 'Vikram Menon',
    members: 15,
    status: 'Active',
  },
  {
    id: 'team-5',
    name: 'Talent',
    code: 'TEAM-TAL',
    department: 'People',
    lead: 'Divya Rao',
    members: 7,
    status: 'Active',
  },
  {
    id: 'team-6',
    name: 'Accounts',
    code: 'TEAM-ACC',
    department: 'Finance',
    lead: 'Rohan Iyer',
    members: 9,
    status: 'Inactive',
  },
];

export const headcountByDepartment: HeadcountByDepartment[] = [
  { department: 'Engineering', headcount: 42 },
  { department: 'Consulting', headcount: 15 },
  { department: 'Design', headcount: 12 },
  { department: 'Finance', headcount: 9 },
  { department: 'People', headcount: 7 },
  { department: 'Management', headcount: 4 },
];

export const locationSummary: LocationSummary[] = locations.map((l) => ({
  location: l.name,
  headcount: l.employees,
}));

export const positionSummary: PositionSummary[] = [
  { status: 'Filled', count: 38 },
  { status: 'Vacant', count: 6 },
  { status: 'Hiring', count: 3 },
  { status: 'On Hold', count: 1 },
];

export const recentOrgChanges: OrgChange[] = [
  {
    id: 'chg-1',
    type: 'Promotion',
    subject: 'Kiran Shah → Senior Engineering Manager',
    from: 'Engineering Manager',
    to: 'Senior Engineering Manager',
    effectiveDate: '2026-09-01',
    changedBy: 'Arjun Mehta',
    status: 'Completed',
  },
  {
    id: 'chg-2',
    type: 'Department Transfer',
    subject: 'Neha Kulkarni → Design',
    from: 'Engineering',
    to: 'Design',
    effectiveDate: '2026-08-15',
    changedBy: 'Divya Rao',
    status: 'Completed',
  },
  {
    id: 'chg-3',
    type: 'Location Transfer',
    subject: 'Rahul Verma → Mumbai Office',
    from: 'Bengaluru HQ',
    to: 'Mumbai Office',
    effectiveDate: '2026-10-01',
    changedBy: 'Sara Thomas',
    status: 'Scheduled',
  },
  {
    id: 'chg-4',
    type: 'Manager Change',
    subject: 'Platform team → Kiran Shah',
    from: 'Arjun Mehta',
    to: 'Kiran Shah',
    effectiveDate: '2026-09-01',
    changedBy: 'Priya Nair',
    status: 'Completed',
  },
  {
    id: 'chg-5',
    type: 'Position Change',
    subject: 'POS-1042 Senior Designer',
    from: 'On Hold',
    to: 'Hiring',
    effectiveDate: '2026-09-20',
    changedBy: 'Meera Krishnan',
    status: 'Pending',
  },
];

/* ------------------------------ aggregates ------------------------------ */

export const totalEmployees = headcountByDepartment.reduce((n, d) => n + d.headcount, 0);

export const totalPositions = positionSummary.reduce((n, p) => n + p.count, 0);

export const vacantPositions =
  positionSummary.find((p) => p.status === 'Vacant')?.count ?? 0;
