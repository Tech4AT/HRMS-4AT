'use client';

import { SectionTabs, type SectionTab } from '@/components/SectionTabs';

const tabs: SectionTab[] = [
  { id: 'attendance', label: 'Attendance', href: '/attendance' },
  { id: 'leave', label: 'Leave Management', href: '/leave' },
  { id: 'calendar', label: 'Calendar', href: '/attendance/calendar' },
];

/** Tab strip for the "My Attendance" group of the wider Attendance & Leave
 *  section (Attendance / Leave Management / Calendar). All three are open to
 *  every employee - Calendar here is read-only (your attendance plus the org
 *  calendar). Approvals and Settings (including editing the org calendar) are
 *  sibling groups with their own tab strips - see approvals/page.tsx and
 *  attendance/settings/page.tsx. */
export function AttendanceLeaveTabs({ active }: { active: 'attendance' | 'leave' | 'calendar' }) {
  return <SectionTabs tabs={tabs} active={active} />;
}
