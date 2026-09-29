'use client';

import { AttendanceLeaveTabs } from '@/components/AttendanceLeaveTabs';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';

/** My Attendance > Calendar - view only. Editing the org calendar (holidays,
 *  WFH days, events) lives under Settings > Calendar Management instead. */
export default function MyCalendarPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <AttendanceLeaveTabs active="calendar" />
      <div className="p-4 sm:p-8">
        <MyAttendanceCalendar />
      </div>
    </div>
  );
}
