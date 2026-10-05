'use client';

import { useRouter } from 'next/navigation';
import { DashboardCard } from './DashboardCard';
import {
  ReceiptIcon,
  FileTextIcon,
  TeamIcon,
  MessageCircleIcon,
} from '@/components/icons';

// Leave/attendance/timesheet quick actions removed until those backends exist
// (their pages 404 → "Upstream error"). Re-add when the peer backends land.
const actions = [
  { id: 'log_expense', label: 'Log Expense', icon: ReceiptIcon, href: '/me/expenses' },
  { id: 'view_payslip', label: 'View Payslip', icon: FileTextIcon, href: '/payslips' },
  { id: 'team_directory', label: 'Team Directory', icon: TeamIcon, href: '/team' },
  { id: 'ask_hr', label: 'Ask HR', icon: MessageCircleIcon, href: '/inbox' },
];

export function QuickActions() {
  const router = useRouter();

  return (
    <DashboardCard title="Quick Actions">
      <div className="grid grid-cols-4 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={() => router.push(action.href)}
              title={action.label}
              className="group flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-[11px] font-medium text-slate-600 text-center leading-tight">
                {action.label}
              </span>
            </button>
          );
        })}
      </div>
    </DashboardCard>
  );
}
