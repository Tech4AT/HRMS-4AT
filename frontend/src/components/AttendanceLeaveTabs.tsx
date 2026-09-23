'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';

const baseTabs = [
  { id: 'attendance', label: 'Attendance', href: '/attendance' },
  { id: 'leave', label: 'Leave Management', href: '/leave' },
] as const;

const approvalsTab = { id: 'approvals', label: 'Approvals', href: '/approvals' } as const;
const calendarTab = { id: 'calendar', label: 'Calendar Management', href: '/attendance/calendar' } as const;

export function AttendanceLeaveTabs({ active }: { active: 'attendance' | 'leave' | 'approvals' | 'calendar' }) {
  const router = useRouter();
  const { hasPermission } = useAuth();

  // Approvals is only relevant to someone who can act on at least one of the
  // request types it aggregates (leave, WFH, regularisation). Calendar
  // Management is HR-admin-only.
  const canApprove = hasPermission('leave.approve') || hasPermission('attendance.approve');
  const canManageCalendar = hasPermission('calendar.manage');

  const tabs = [
    ...baseTabs,
    ...(canApprove ? [approvalsTab] : []),
    ...(canManageCalendar ? [calendarTab] : []),
  ];

  return (
    <div className="bg-white border-b border-gray-200 px-4 sm:px-8">
      <div className="flex gap-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => router.push(tab.href)}
            className={`px-1 py-3 border-b-2 font-semibold text-sm transition-colors ${
              active === tab.id
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
