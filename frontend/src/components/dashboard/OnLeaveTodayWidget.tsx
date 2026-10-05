'use client';

import { useEffect, useState } from 'react';
import { DashboardCard } from './DashboardCard';
import { teamAttendanceApi } from '@/lib/api/teamAttendance';
import { toLocalISODate } from '@/lib/attendance/dashboard';

const COLORS = [
  'from-purple-600 to-indigo-600',
  'from-rose-600 to-pink-600',
  'from-emerald-600 to-teal-600',
  'from-sky-600 to-blue-600',
  'from-amber-600 to-orange-600',
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

interface OnLeave {
  employeeId: string;
  name: string;
  leaveType: string;
}

/** Who is on approved leave today, among the people the signed-in user may see
 *  (their team, or the whole organisation for HR) - from the team attendance feed. */
export function OnLeaveTodayWidget() {
  const [rows, setRows] = useState<OnLeave[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const today = toLocalISODate(new Date());
    teamAttendanceApi
      .getDaily(today, today)
      .then((data) => {
        if (!active) return;
        setRows(
          data
            .filter((r) => r.on_leave)
            .map((r) => ({
              employeeId: r.employee_id,
              name: r.employee_name,
              leaveType: r.leave_type_name || 'Leave',
            })),
        );
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const list = rows ?? [];

  return (
    <DashboardCard title={`On Leave Today (${list.length})`} actionLabel="View all" actionHref="/team">
      {failed ? (
        <p className="text-xs text-slate-400">Couldn&apos;t be loaded right now.</p>
      ) : rows === null ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-slate-400">Nobody is on leave today.</p>
      ) : (
        <div className="space-y-3">
          {list.map((r, i) => (
            <div key={r.employeeId} className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full bg-gradient-to-br ${COLORS[i % COLORS.length]} flex items-center justify-center text-white text-xs font-bold shrink-0`}
              >
                {initials(r.name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                <p className="text-xs text-slate-500 truncate">{r.leaveType}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}
