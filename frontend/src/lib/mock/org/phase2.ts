/**
 * ORG module Phase-2 MOCK data — FRONTEND ONLY. No persistence, no network.
 * Job Architecture (families, titles, levels, grades, positions) and
 * Org Changes (promotions, department/location/position/manager changes).
 * Imports shared base types read-only; new Phase-2 types live here so
 * data.ts, types.ts, ui.tsx and layout.tsx stay untouched.
 */
import type { MasterStatus } from './types';

/* ------------------------------ job architecture ------------------------------ */

export interface JobFamily {
  id: string;
  name: string;
  code: string;
  description: string;
  titles: number;
  employees: number;
  status: MasterStatus;
}

export interface JobTitle {
  id: string;
  title: string;
  code: string;
  family: string;
  level: string;
  positions: number;
  status: MasterStatus;
}

export interface Level {
  id: string;
  name: string;
  title: string;
  experience: string;
  description: string;
  status: MasterStatus;
}

export interface Grade {
  id: string;
  band: string;
  level: string;
  minSalary: string;
  maxSalary: string;
  currency: string;
  effectiveDate: string;
  status: MasterStatus;
}

export type PositionRowStatus = 'Filled' | 'Vacant' | 'Hiring' | 'On Hold';

export interface Position {
  id: string;
  positionId: string;
  title: string;
  department: string;
  level: string;
  reportsTo: string;
  status: PositionRowStatus;
  /** Empty string when vacant — the row still exists. */
  incumbent: string;
}

export const jobFamilies: JobFamily[] = [
  { id: 'jf-1', name: 'Engineering', code: 'JF-ENG', description: 'Software, platform and infrastructure roles', titles: 4, employees: 42, status: 'Active' },
  { id: 'jf-2', name: 'Design', code: 'JF-DES', description: 'Product, brand and research roles', titles: 3, employees: 12, status: 'Active' },
  { id: 'jf-3', name: 'Consulting', code: 'JF-CON', description: 'Client delivery and advisory roles', titles: 2, employees: 15, status: 'Active' },
  { id: 'jf-4', name: 'Finance', code: 'JF-FIN', description: 'Accounting, payroll and compliance roles', titles: 2, employees: 9, status: 'Active' },
  { id: 'jf-5', name: 'People', code: 'JF-PPL', description: 'Talent, HR operations and culture roles', titles: 2, employees: 7, status: 'Active' },
  { id: 'jf-6', name: 'Management', code: 'JF-MGT', description: 'Leadership and functional-head roles', titles: 1, employees: 4, status: 'Active' },
  { id: 'jf-7', name: 'Data & AI', code: 'JF-DAT', description: 'Planned analytics roles (kept inactive for now)', titles: 0, employees: 0, status: 'Inactive' },
];

export const jobTitles: JobTitle[] = [
  { id: 'jt-1', title: 'Software Engineer', code: 'JT-SE', family: 'Engineering', level: 'L2', positions: 14, status: 'Active' },
  { id: 'jt-2', title: 'Senior Software Engineer', code: 'JT-SSE', family: 'Engineering', level: 'L3', positions: 10, status: 'Active' },
  { id: 'jt-3', title: 'Engineering Manager', code: 'JT-EM', family: 'Engineering', level: 'L4', positions: 4, status: 'Active' },
  { id: 'jt-4', title: 'Senior Engineering Manager', code: 'JT-SEM', family: 'Engineering', level: 'L5', positions: 2, status: 'Active' },
  { id: 'jt-5', title: 'Product Designer', code: 'JT-PD', family: 'Design', level: 'L2', positions: 6, status: 'Active' },
  { id: 'jt-6', title: 'Senior Product Designer', code: 'JT-SPD', family: 'Design', level: 'L3', positions: 3, status: 'Active' },
  { id: 'jt-7', title: 'Design Lead', code: 'JT-DL', family: 'Design', level: 'L4', positions: 1, status: 'Active' },
  { id: 'jt-8', title: 'Consultant', code: 'JT-CNS', family: 'Consulting', level: 'L2', positions: 9, status: 'Active' },
  { id: 'jt-9', title: 'Senior Consultant', code: 'JT-SCNS', family: 'Consulting', level: 'L3', positions: 6, status: 'Active' },
  { id: 'jt-10', title: 'Accountant', code: 'JT-ACT', family: 'Finance', level: 'L2', positions: 5, status: 'Active' },
  { id: 'jt-11', title: 'Finance Manager', code: 'JT-FM', family: 'Finance', level: 'L4', positions: 1, status: 'Active' },
  { id: 'jt-12', title: 'Talent Partner', code: 'JT-TP', family: 'People', level: 'L2', positions: 4, status: 'Active' },
  { id: 'jt-13', title: 'Data Analyst', code: 'JT-DA', family: 'Data & AI', level: 'L2', positions: 0, status: 'Inactive' },
];

export const levels: Level[] = [
  { id: 'lvl-1', name: 'L1', title: 'Associate', experience: '0–1 yrs', description: 'Entry-level, works under guidance', status: 'Active' },
  { id: 'lvl-2', name: 'L2', title: 'Professional', experience: '1–3 yrs', description: 'Independent contributor on defined scope', status: 'Active' },
  { id: 'lvl-3', name: 'L3', title: 'Senior', experience: '3–6 yrs', description: 'Owns outcomes, mentors L1–L2', status: 'Active' },
  { id: 'lvl-4', name: 'L4', title: 'Lead / Manager', experience: '6–9 yrs', description: 'Leads a team or a large workstream', status: 'Active' },
  { id: 'lvl-5', name: 'L5', title: 'Senior Manager', experience: '9–12 yrs', description: 'Owns a function or large programme', status: 'Active' },
  { id: 'lvl-6', name: 'L6', title: 'Director', experience: '12–15 yrs', description: 'Owns a department P&L and strategy', status: 'Active' },
  { id: 'lvl-7', name: 'L7', title: 'Executive', experience: '15+ yrs', description: 'Organisation-level leadership', status: 'Active' },
];

export const grades: Grade[] = [
  { id: 'gr-1', band: 'G1', level: 'L1', minSalary: '₹4,00,000', maxSalary: '₹6,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-2', band: 'G2', level: 'L2', minSalary: '₹6,00,000', maxSalary: '₹10,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-3', band: 'G3', level: 'L3', minSalary: '₹10,00,000', maxSalary: '₹16,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-4', band: 'G4', level: 'L4', minSalary: '₹16,00,000', maxSalary: '₹24,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-5', band: 'G5', level: 'L5', minSalary: '₹24,00,000', maxSalary: '₹36,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-6', band: 'G6', level: 'L6', minSalary: '₹36,00,000', maxSalary: '₹55,00,000', currency: 'INR', effectiveDate: '2026-04-01', status: 'Active' },
  { id: 'gr-7', band: 'G7 (legacy)', level: 'L6', minSalary: '₹30,00,000', maxSalary: '₹48,00,000', currency: 'INR', effectiveDate: '2025-04-01', status: 'Inactive' },
];

export const positions: Position[] = [
  { id: 'pos-1', positionId: 'POS-1001', title: 'Senior Software Engineer', department: 'Engineering', level: 'L3', reportsTo: 'Kiran Shah', status: 'Filled', incumbent: 'Rahul Verma' },
  { id: 'pos-2', positionId: 'POS-1002', title: 'Software Engineer', department: 'Engineering', level: 'L2', reportsTo: 'Kiran Shah', status: 'Filled', incumbent: 'Neha Kulkarni' },
  { id: 'pos-3', positionId: 'POS-1003', title: 'Software Engineer', department: 'Engineering', level: 'L2', reportsTo: 'Anita Desai', status: 'Hiring', incumbent: '' },
  { id: 'pos-4', positionId: 'POS-1004', title: 'Engineering Manager', department: 'Engineering', level: 'L4', reportsTo: 'Arjun Mehta', status: 'Filled', incumbent: 'Kiran Shah' },
  { id: 'pos-5', positionId: 'POS-1005', title: 'Senior Engineering Manager', department: 'Engineering', level: 'L5', reportsTo: 'Arjun Mehta', status: 'Filled', incumbent: 'Kiran Shah' },
  { id: 'pos-6', positionId: 'POS-1011', title: 'Product Designer', department: 'Design', level: 'L2', reportsTo: 'Meera Krishnan', status: 'Filled', incumbent: 'Neha Kulkarni' },
  { id: 'pos-7', positionId: 'POS-1012', title: 'Senior Designer', department: 'Design', level: 'L3', reportsTo: 'Meera Krishnan', status: 'Hiring', incumbent: '' },
  { id: 'pos-8', positionId: 'POS-1021', title: 'Senior Consultant', department: 'Consulting', level: 'L3', reportsTo: 'Vikram Menon', status: 'Filled', incumbent: 'Sara Thomas' },
  { id: 'pos-9', positionId: 'POS-1022', title: 'Consultant', department: 'Consulting', level: 'L2', reportsTo: 'Vikram Menon', status: 'Vacant', incumbent: '' },
  { id: 'pos-10', positionId: 'POS-1031', title: 'Accountant', department: 'Finance', level: 'L2', reportsTo: 'Rohan Iyer', status: 'Filled', incumbent: 'Divya Nair' },
  { id: 'pos-11', positionId: 'POS-1032', title: 'Finance Manager', department: 'Finance', level: 'L4', reportsTo: 'Priya Nair', status: 'On Hold', incumbent: '' },
  { id: 'pos-12', positionId: 'POS-1041', title: 'Talent Partner', department: 'People', level: 'L2', reportsTo: 'Divya Rao', status: 'Vacant', incumbent: '' },
];

/* ------------------------------ org changes ------------------------------ */

export type ChangeStatus = 'Completed' | 'Pending' | 'Scheduled';

export interface ChangeRecord {
  id: string;
  employee: string;
  from: string;
  to: string;
  effectiveDate: string;
  status: ChangeStatus;
  changedBy: string;
  /** Audit-trail timestamp: when the change was recorded. */
  updatedAt: string;
}

export const promotions: ChangeRecord[] = [
  { id: 'prm-1', employee: 'Kiran Shah', from: 'Engineering Manager', to: 'Senior Engineering Manager', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Arjun Mehta', updatedAt: '2026-08-22 10:14' },
  { id: 'prm-2', employee: 'Rahul Verma', from: 'Software Engineer', to: 'Senior Software Engineer', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Kiran Shah', updatedAt: '2026-08-22 11:02' },
  { id: 'prm-3', employee: 'Neha Kulkarni', from: 'Product Designer', to: 'Senior Product Designer', effectiveDate: '2026-10-01', status: 'Scheduled', changedBy: 'Meera Krishnan', updatedAt: '2026-09-10 15:40' },
  { id: 'prm-4', employee: 'Vikram Menon', from: 'Consultant', to: 'Senior Consultant', effectiveDate: '2026-10-01', status: 'Pending', changedBy: 'Sara Thomas', updatedAt: '2026-09-18 09:27' },
  { id: 'prm-5', employee: 'Divya Nair', from: 'Junior Accountant', to: 'Accountant', effectiveDate: '2026-08-01', status: 'Completed', changedBy: 'Rohan Iyer', updatedAt: '2026-07-21 14:05' },
];

export const departmentTransfers: ChangeRecord[] = [
  { id: 'dpt-1', employee: 'Neha Kulkarni', from: 'Engineering', to: 'Design', effectiveDate: '2026-08-15', status: 'Completed', changedBy: 'Divya Rao', updatedAt: '2026-08-05 12:30' },
  { id: 'dpt-2', employee: 'Amit Joshi', from: 'Consulting', to: 'Engineering', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Arjun Mehta', updatedAt: '2026-08-20 16:11' },
  { id: 'dpt-3', employee: 'Farah Khan', from: 'Finance', to: 'People', effectiveDate: '2026-10-01', status: 'Scheduled', changedBy: 'Priya Nair', updatedAt: '2026-09-12 10:48' },
  { id: 'dpt-4', employee: 'Suresh Pillai', from: 'Engineering', to: 'Consulting', effectiveDate: '2026-10-15', status: 'Pending', changedBy: 'Sara Thomas', updatedAt: '2026-09-19 13:22' },
  { id: 'dpt-5', employee: 'Lakshmi Reddy', from: 'Design', to: 'Engineering', effectiveDate: '2026-07-01', status: 'Completed', changedBy: 'Meera Krishnan', updatedAt: '2026-06-22 09:15' },
];

export const locationTransfers: ChangeRecord[] = [
  { id: 'lct-1', employee: 'Rahul Verma', from: 'Bengaluru HQ', to: 'Mumbai Office', effectiveDate: '2026-10-01', status: 'Scheduled', changedBy: 'Sara Thomas', updatedAt: '2026-09-08 11:36' },
  { id: 'lct-2', employee: 'Anita Desai', from: 'Mumbai Office', to: 'Bengaluru HQ', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Arjun Mehta', updatedAt: '2026-08-18 14:52' },
  { id: 'lct-3', employee: 'Kiran Shah', from: 'Remote (India)', to: 'Bengaluru HQ', effectiveDate: '2026-08-01', status: 'Completed', changedBy: 'Divya Rao', updatedAt: '2026-07-25 10:09' },
  { id: 'lct-4', employee: 'Daniel Cole', from: 'New York Office', to: 'Remote (India)', effectiveDate: '2026-11-01', status: 'Pending', changedBy: 'Priya Nair', updatedAt: '2026-09-20 17:44' },
  { id: 'lct-5', employee: 'Meera Krishnan', from: 'Bengaluru HQ', to: 'Remote (India)', effectiveDate: '2026-09-15', status: 'Completed', changedBy: 'Divya Rao', updatedAt: '2026-09-02 12:20' },
];

export const positionChanges: ChangeRecord[] = [
  { id: 'psc-1', employee: 'POS-1012 Senior Designer', from: 'On Hold', to: 'Hiring', effectiveDate: '2026-09-20', status: 'Pending', changedBy: 'Meera Krishnan', updatedAt: '2026-09-18 09:31' },
  { id: 'psc-2', employee: 'POS-1022 Consultant', from: 'Filled', to: 'Vacant', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Vikram Menon', updatedAt: '2026-08-28 15:07' },
  { id: 'psc-3', employee: 'POS-1032 Finance Manager', from: 'Hiring', to: 'On Hold', effectiveDate: '2026-09-10', status: 'Completed', changedBy: 'Rohan Iyer', updatedAt: '2026-09-09 11:19' },
  { id: 'psc-4', employee: 'POS-1003 Software Engineer', from: 'Vacant', to: 'Hiring', effectiveDate: '2026-10-01', status: 'Scheduled', changedBy: 'Kiran Shah', updatedAt: '2026-09-15 13:58' },
  { id: 'psc-5', employee: 'POS-1041 Talent Partner', from: 'Hiring', to: 'Vacant', effectiveDate: '2026-08-20', status: 'Completed', changedBy: 'Divya Rao', updatedAt: '2026-08-19 10:26' },
];

export const managerChanges: ChangeRecord[] = [
  { id: 'mgc-1', employee: 'Platform team', from: 'Arjun Mehta', to: 'Kiran Shah', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Priya Nair', updatedAt: '2026-08-25 16:33' },
  { id: 'mgc-2', employee: 'Rahul Verma', from: 'Anita Desai', to: 'Kiran Shah', effectiveDate: '2026-09-01', status: 'Completed', changedBy: 'Arjun Mehta', updatedAt: '2026-08-25 16:40' },
  { id: 'mgc-3', employee: 'Neha Kulkarni', from: 'Kiran Shah', to: 'Meera Krishnan', effectiveDate: '2026-08-15', status: 'Completed', changedBy: 'Divya Rao', updatedAt: '2026-08-05 12:35' },
  { id: 'mgc-4', employee: 'Mobile team', from: 'Kiran Shah', to: 'Anita Desai', effectiveDate: '2026-10-01', status: 'Scheduled', changedBy: 'Arjun Mehta', updatedAt: '2026-09-14 09:12' },
  { id: 'mgc-5', employee: 'Amit Joshi', from: 'Vikram Menon', to: 'Kiran Shah', effectiveDate: '2026-10-15', status: 'Pending', changedBy: 'Sara Thomas', updatedAt: '2026-09-19 14:03' },
];
