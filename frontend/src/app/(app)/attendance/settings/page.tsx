'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { SectionTabs, type SectionTab } from '@/components/SectionTabs';
import { CalendarManagementPanel } from '@/components/attendance/CalendarManagementPanel';
import { PenalizationSettingsPanel } from '@/components/attendance/PenalizationSettingsPanel';
import { ShiftsSettingsPanel } from '@/components/attendance/ShiftsSettingsPanel';
import { LeaveSettingsPanel } from '@/components/attendance/LeaveSettingsPanel';

type SettingsTabId = 'shifts' | 'leave' | 'calendar' | 'penalization';

/** Org-level configuration for the Attendance & Leave section: Shifts, Leave
 *  Settings, Calendar Management (editing the org calendar - holidays, WFH
 *  days, events), and Policy Settings (penalisation + Comp Off accrual
 *  rules - see PenalizationSettingsPanel; the "Policy Settings" label is the
 *  user-facing name, the internal tab id/component keep their old name). */
export default function AttendanceSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoading: authLoading, hasPermission } = useAuth();
  const canManageSettings = hasPermission('attendance.settings.manage');
  const canManageCalendar = hasPermission('calendar.manage');
  const canAccess = canManageSettings || canManageCalendar;

  useEffect(() => {
    if (!authLoading && !canAccess) router.replace('/');
  }, [authLoading, canAccess, router]);

  const tabs: SectionTab[] = [
    ...(canManageSettings ? [{ id: 'shifts', label: 'Shifts', href: '/attendance/settings?tab=shifts' }] : []),
    ...(canManageSettings ? [{ id: 'leave', label: 'Leave Settings', href: '/attendance/settings?tab=leave' }] : []),
    ...(canManageCalendar
      ? [{ id: 'calendar', label: 'Calendar Management', href: '/attendance/settings?tab=calendar' }]
      : []),
    ...(canManageSettings
      ? [{ id: 'penalization', label: 'Policy Settings', href: '/attendance/settings?tab=penalization' }]
      : []),
  ];

  const requestedTab = searchParams.get('tab');
  const activeTab = (tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0]?.id) as SettingsTabId;

  if (authLoading || !canAccess) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <SectionTabs tabs={tabs} active={activeTab} />
      <div className="p-4 sm:p-8">
        {activeTab === 'calendar' ? (
          <CalendarManagementPanel />
        ) : activeTab === 'penalization' ? (
          <PenalizationSettingsPanel />
        ) : activeTab === 'shifts' ? (
          <ShiftsSettingsPanel />
        ) : (
          <LeaveSettingsPanel />
        )}
      </div>
    </div>
  );
}
