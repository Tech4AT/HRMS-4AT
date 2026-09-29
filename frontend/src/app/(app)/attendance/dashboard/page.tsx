'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { AttendanceDashboard } from '@/components/attendance/AttendanceDashboard';

/** Attendance & Leave > Dashboard - attendance/leave analytics for a
 *  manager's reportees, or the whole organisation for an org-scoped HR
 *  admin. Only relevant to people who manage others or oversee the org, so
 *  it's gated the same way Approvals is. */
export default function AttendanceDashboardPage() {
  const router = useRouter();
  const { isLoading, hasPermission, hasOrgScope } = useAuth();
  const canAccess = hasPermission('leave.approve') || hasPermission('attendance.approve') || hasOrgScope();

  useEffect(() => {
    if (!isLoading && !canAccess) router.replace('/');
  }, [isLoading, canAccess, router]);

  if (isLoading || !canAccess) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <div className="p-4 sm:p-8">
        <AttendanceDashboard />
      </div>
    </div>
  );
}
