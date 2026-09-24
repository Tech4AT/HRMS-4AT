/** Shared sample (frontend-only) employee roster used by the various
 *  Settings features that need one - Shifts assignment, Leave Balances -
 *  since there's no real employee directory available in the mock backend
 *  (see mock-data.ts's dispatcher fallback). One list keeps the same people
 *  showing up consistently across those features instead of each inventing
 *  its own roster. */

export interface SampleEmployee {
  id: string;
  name: string;
  employeeNumber: string;
  team: string;
  department: string;
  businessUnit: string;
  location: string;
}

export const SAMPLE_EMPLOYEES: SampleEmployee[] = [
  {
    id: 'emp-demo',
    name: 'Demo User',
    employeeNumber: '4AT0000',
    team: 'Engineering',
    department: 'Technology',
    businessUnit: 'Technology',
    location: 'Hyderabad',
  },
  {
    id: 'emp-aditi',
    name: 'Aditi Sharma',
    employeeNumber: '4AT0001',
    team: 'Engineering',
    department: 'Technology',
    businessUnit: 'Technology',
    location: 'Hyderabad',
  },
  {
    id: 'emp-rahul',
    name: 'Rahul Verma',
    employeeNumber: '4AT0002',
    team: 'Sales',
    department: 'Sales',
    businessUnit: 'Revenue',
    location: 'Bengaluru',
  },
  {
    id: 'emp-vikram',
    name: 'Vikram Singh',
    employeeNumber: '4AT0003',
    team: 'Sales',
    department: 'Sales',
    businessUnit: 'Revenue',
    location: 'Bengaluru',
  },
  {
    id: 'emp-priya',
    name: 'Priya Nair',
    employeeNumber: '4AT0004',
    team: 'Support',
    department: 'Customer Support',
    businessUnit: 'Operations',
    location: 'Mumbai',
  },
  {
    id: 'emp-sanjay',
    name: 'Sanjay Mehta',
    employeeNumber: '4AT0005',
    team: 'Support',
    department: 'Customer Support',
    businessUnit: 'Operations',
    location: 'Mumbai',
  },
  {
    id: 'emp-neha',
    name: 'Neha Kapoor',
    employeeNumber: '4AT0006',
    team: 'HR',
    department: 'Human Resources',
    businessUnit: 'Corporate',
    location: 'Hyderabad',
  },
];
