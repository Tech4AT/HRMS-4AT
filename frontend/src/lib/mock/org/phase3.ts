/**
 * ORG module PHASE-3 MOCK data — FRONTEND ONLY. No persistence, no network.
 * Onboarding (preboarding / new joiners / onboarding progress / task
 * templates / BGV) + Settings (org configuration / hierarchy rules /
 * naming & codes). Values reference the Phase-1 masters in data.ts
 * (departments, locations, positions) as "selected-from-masters".
 */

export type PreboardStage =
  | 'Offer Accepted'
  | 'Documents Pending'
  | 'BGV In Progress'
  | 'Ready to Join';

export interface PreboardCandidate {
  id: string;
  name: string;
  doj: string;
  position: string;
  department: string;
  location: string;
  docs: 'Complete' | 'Partial' | 'Pending';
  bgv: 'Not Started' | 'In Progress' | 'Clear' | 'Discrepancy';
  stage: PreboardStage;
}

export const preboardStages: PreboardStage[] = [
  'Offer Accepted',
  'Documents Pending',
  'BGV In Progress',
  'Ready to Join',
];

export const preboardCandidates: PreboardCandidate[] = [
  {
    id: 'pb-1',
    name: 'Ananya Rao',
    doj: '2026-10-06',
    position: 'Senior Engineer',
    department: 'Engineering',
    location: 'Bengaluru HQ',
    docs: 'Complete',
    bgv: 'In Progress',
    stage: 'BGV In Progress',
  },
  {
    id: 'pb-2',
    name: 'Farhan Qureshi',
    doj: '2026-10-06',
    position: 'Consultant',
    department: 'Consulting',
    location: 'Mumbai Office',
    docs: 'Complete',
    bgv: 'Clear',
    stage: 'Ready to Join',
  },
  {
    id: 'pb-3',
    name: 'Sneha Pillai',
    doj: '2026-10-13',
    position: 'Product Designer',
    department: 'Design',
    location: 'Bengaluru HQ',
    docs: 'Partial',
    bgv: 'Not Started',
    stage: 'Documents Pending',
  },
  {
    id: 'pb-4',
    name: 'Arvind Natarajan',
    doj: '2026-10-13',
    position: 'Engineering Manager',
    department: 'Engineering',
    location: 'Remote (India)',
    docs: 'Complete',
    bgv: 'Not Started',
    stage: 'BGV In Progress',
  },
  {
    id: 'pb-5',
    name: 'Kavya Reddy',
    doj: '2026-10-20',
    position: 'Finance Analyst',
    department: 'Finance',
    location: 'Bengaluru HQ',
    docs: 'Pending',
    bgv: 'Not Started',
    stage: 'Offer Accepted',
  },
  {
    id: 'pb-6',
    name: 'Imran Sheikh',
    doj: '2026-10-20',
    position: 'Talent Partner',
    department: 'People',
    location: 'New York Office',
    docs: 'Partial',
    bgv: 'Not Started',
    stage: 'Documents Pending',
  },
];

/* ------------------------------ new joiners ------------------------------ */

export interface NewJoiner {
  id: string;
  name: string;
  doj: string;
  position: string;
  department: string;
  location: string;
  buddy: string;
  manager: string;
  readiness: string;
  group: 'Upcoming' | 'Recent';
}

export const newJoiners: NewJoiner[] = [
  {
    id: 'nj-1',
    name: 'Farhan Qureshi',
    doj: '2026-10-06',
    position: 'Consultant',
    department: 'Consulting',
    location: 'Mumbai Office',
    buddy: 'Vikram Menon',
    manager: 'Sara Thomas',
    readiness: '4/4 ready',
    group: 'Upcoming',
  },
  {
    id: 'nj-2',
    name: 'Ananya Rao',
    doj: '2026-10-06',
    position: 'Senior Engineer',
    department: 'Engineering',
    location: 'Bengaluru HQ',
    buddy: 'Kiran Shah',
    manager: 'Arjun Mehta',
    readiness: '3/4 ready',
    group: 'Upcoming',
  },
  {
    id: 'nj-3',
    name: 'Ritu Malhotra',
    doj: '2026-09-22',
    position: 'Brand Designer',
    department: 'Design',
    location: 'Bengaluru HQ',
    buddy: 'Meera Krishnan',
    manager: 'Meera Krishnan',
    readiness: '4/4 ready',
    group: 'Recent',
  },
  {
    id: 'nj-4',
    name: 'Sahil Khan',
    doj: '2026-09-15',
    position: 'Platform Engineer',
    department: 'Engineering',
    location: 'Remote (India)',
    buddy: 'Anita Desai',
    manager: 'Kiran Shah',
    readiness: '4/4 ready',
    group: 'Recent',
  },
  {
    id: 'nj-5',
    name: 'Pooja Hegde',
    doj: '2026-09-08',
    position: 'Accounts Executive',
    department: 'Finance',
    location: 'Bengaluru HQ',
    buddy: 'Rohan Iyer',
    manager: 'Rohan Iyer',
    readiness: '2/4 ready',
    group: 'Recent',
  },
];

/* ------------------------------ onboarding ------------------------------ */

export type ChecklistStatus = 'Done' | 'In Progress' | 'Pending';

export interface OnboardingChecklistItem {
  id: string;
  task: string;
  owner: string;
  due: string;
  status: ChecklistStatus;
}

export interface OnboardingProgress {
  id: string;
  joiner: string;
  template: string;
  progress: number;
  tasks: OnboardingChecklistItem[];
}

export const onboardingProgress: OnboardingProgress[] = [
  {
    id: 'ob-1',
    joiner: 'Ritu Malhotra',
    template: 'Design onboarding (2 weeks)',
    progress: 80,
    tasks: [
      { id: 'ob-1-t1', task: 'HR orientation & policies', owner: 'Divya Rao', due: 'Day 1', status: 'Done' },
      { id: 'ob-1-t2', task: 'Laptop & tool access', owner: 'IT Helpdesk', due: 'Day 1', status: 'Done' },
      { id: 'ob-1-t3', task: 'Design system walkthrough', owner: 'Meera Krishnan', due: 'Week 1', status: 'Done' },
      { id: 'ob-1-t4', task: 'First brief assigned', owner: 'Meera Krishnan', due: 'Week 2', status: 'In Progress' },
      { id: 'ob-1-t5', task: '30-day check-in', owner: 'Divya Rao', due: 'Day 30', status: 'Pending' },
    ],
  },
  {
    id: 'ob-2',
    joiner: 'Sahil Khan',
    template: 'Engineering onboarding (30-60-90)',
    progress: 60,
    tasks: [
      { id: 'ob-2-t1', task: 'HR orientation & policies', owner: 'Divya Rao', due: 'Day 1', status: 'Done' },
      { id: 'ob-2-t2', task: 'Dev environment setup', owner: 'IT Helpdesk', due: 'Day 2', status: 'Done' },
      { id: 'ob-2-t3', task: 'Codebase tour with buddy', owner: 'Anita Desai', due: 'Week 1', status: 'Done' },
      { id: 'ob-2-t4', task: 'First production deploy', owner: 'Kiran Shah', due: 'Week 3', status: 'In Progress' },
      { id: 'ob-2-t5', task: '30-day review', owner: 'Kiran Shah', due: 'Day 30', status: 'Pending' },
    ],
  },
  {
    id: 'ob-3',
    joiner: 'Pooja Hegde',
    template: 'Finance onboarding (2 weeks)',
    progress: 40,
    tasks: [
      { id: 'ob-3-t1', task: 'HR orientation & policies', owner: 'Divya Rao', due: 'Day 1', status: 'Done' },
      { id: 'ob-3-t2', task: 'Finance systems access', owner: 'IT Helpdesk', due: 'Day 2', status: 'In Progress' },
      { id: 'ob-3-t3', task: 'Month-close shadow', owner: 'Rohan Iyer', due: 'Week 2', status: 'Pending' },
      { id: 'ob-3-t4', task: 'Compliance training', owner: 'Divya Rao', due: 'Day 30', status: 'Pending' },
    ],
  },
];

/* ------------------------------ task templates ------------------------------ */

export type TemplateCategory = 'HR' | 'Manager' | 'IT' | 'Finance' | 'Employee';

export interface TaskTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  tasks: number;
  ownerRole: string;
  dueOffset: string;
}

export const taskTemplates: TaskTemplate[] = [
  { id: 'tt-1', name: 'Day-one HR checklist', category: 'HR', tasks: 8, ownerRole: 'HR Partner', dueOffset: 'Day 1' },
  { id: 'tt-2', name: 'Policy acknowledgements', category: 'HR', tasks: 5, ownerRole: 'HR Partner', dueOffset: 'Week 1' },
  { id: 'tt-3', name: 'Manager welcome plan', category: 'Manager', tasks: 6, ownerRole: 'Hiring Manager', dueOffset: 'Week 1' },
  { id: 'tt-4', name: '30-60-90 goals', category: 'Manager', tasks: 4, ownerRole: 'Hiring Manager', dueOffset: 'Day 30' },
  { id: 'tt-5', name: 'Laptop & access provisioning', category: 'IT', tasks: 7, ownerRole: 'IT Helpdesk', dueOffset: 'Before Day 1' },
  { id: 'tt-6', name: 'Tool & repo access', category: 'IT', tasks: 6, ownerRole: 'IT Helpdesk', dueOffset: 'Day 2' },
  { id: 'tt-7', name: 'Payroll & bank setup', category: 'Finance', tasks: 4, ownerRole: 'Payroll Admin', dueOffset: 'Day 1' },
  { id: 'tt-8', name: 'Self-serve profile completion', category: 'Employee', tasks: 5, ownerRole: 'Joiner', dueOffset: 'Week 1' },
];

/* ------------------------------ background verification ------------------------------ */

export type BgvStatus = 'Initiated' | 'In Progress' | 'Completed';

export interface BgvCase {
  id: string;
  candidate: string;
  vendor: string;
  initiated: string;
  status: BgvStatus;
  result: 'Clear' | 'Discrepancy' | 'Pending';
  completed: string;
}

export const bgvCases: BgvCase[] = [
  {
    id: 'bgv-1',
    candidate: 'Farhan Qureshi',
    vendor: 'VeriCheck Solutions',
    initiated: '2026-09-10',
    status: 'Completed',
    result: 'Clear',
    completed: '2026-09-24',
  },
  {
    id: 'bgv-2',
    candidate: 'Ananya Rao',
    vendor: 'VeriCheck Solutions',
    initiated: '2026-09-18',
    status: 'In Progress',
    result: 'Pending',
    completed: '—',
  },
  {
    id: 'bgv-3',
    candidate: 'Arvind Natarajan',
    vendor: 'TrustScreen India',
    initiated: '2026-09-22',
    status: 'In Progress',
    result: 'Pending',
    completed: '—',
  },
  {
    id: 'bgv-4',
    candidate: 'Ritu Malhotra',
    vendor: 'TrustScreen India',
    initiated: '2026-08-28',
    status: 'Completed',
    result: 'Clear',
    completed: '2026-09-12',
  },
  {
    id: 'bgv-5',
    candidate: 'Sahil Khan',
    vendor: 'VeriCheck Solutions',
    initiated: '2026-08-20',
    status: 'Completed',
    result: 'Discrepancy',
    completed: '2026-09-05',
  },
];

/* ------------------------------ settings defaults ------------------------------ */

export interface SettingField {
  key: string;
  label: string;
  value: string;
  options?: string[];
  hint?: string;
}

export const orgConfigurationDefaults: SettingField[] = [
  {
    key: 'defaultLegalEntity',
    label: 'Default legal entity',
    value: 'Acme Technologies Pvt Ltd',
    options: ['Acme Technologies Pvt Ltd', 'Acme Inc'],
  },
  {
    key: 'hierarchyOrder',
    label: 'Hierarchy order',
    value: 'Legal Entity → Business Unit → Location / Department → Team → Position → Employee',
    hint: 'Fixed order for drill-downs and breadcrumbs.',
  },
  {
    key: 'effectiveDating',
    label: 'Effective-dated changes',
    value: 'Enabled',
    options: ['Enabled', 'Disabled'],
    hint: 'Org changes carry an effective date and keep history.',
  },
  {
    key: 'positionMandatory',
    label: 'Position mandatory for employees',
    value: 'Yes',
    options: ['Yes', 'No'],
  },
  {
    key: 'multiBuAssignment',
    label: 'Allow multi-BU assignment',
    value: 'No',
    options: ['Yes', 'No'],
  },
];

export const hierarchyRuleDefaults: SettingField[] = [
  {
    key: 'maxLevels',
    label: 'Maximum hierarchy levels',
    value: '8',
    hint: 'Legal entity counts as level 1.',
  },
  {
    key: 'maxSpan',
    label: 'Maximum span of control',
    value: '12',
    hint: 'Direct reports allowed per manager.',
  },
  {
    key: 'managerRequired',
    label: 'Manager required per team',
    value: 'Yes',
    options: ['Yes', 'No'],
  },
  {
    key: 'matrixReporting',
    label: 'Matrix (dotted-line) reporting',
    value: 'Allowed',
    options: ['Allowed', 'Not allowed'],
  },
  {
    key: 'vacantPositionHiring',
    label: 'Vacant positions open for hiring',
    value: 'Auto',
    options: ['Auto', 'Manual approval'],
  },
];

export const namingCodeDefaults: SettingField[] = [
  {
    key: 'legalEntity',
    label: 'Legal entity prefix',
    value: 'IN-LE- / US-LE-',
    hint: 'Example: IN-LE-01',
  },
  {
    key: 'businessUnit',
    label: 'Business unit prefix',
    value: 'BU-',
    hint: 'Example: BU-PRD',
  },
  {
    key: 'location',
    label: 'Location prefix',
    value: '<CITY>-',
    hint: 'Example: BLR-HQ',
  },
  {
    key: 'department',
    label: 'Department prefix',
    value: 'DEPT-',
    hint: 'Example: DEPT-ENG',
  },
  {
    key: 'team',
    label: 'Team prefix',
    value: 'TEAM-',
    hint: 'Example: TEAM-PLT',
  },
  {
    key: 'sequence',
    label: 'Sequence padding',
    value: '2 digits',
    options: ['2 digits', '3 digits', '4 digits'],
  },
];
