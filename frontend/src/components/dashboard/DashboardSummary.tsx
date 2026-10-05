'use client';

import { useEffect, useState } from 'react';
import { SummaryMetricCard } from './SummaryMetricCard';
import { ClockIcon, CalendarIcon, ClipboardCheckIcon, WalletIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth/useAuth';
import { attendanceApi, type AttendanceDayView } from '@/lib/api/attendance';
import { leaveApi, formatDays, type LeaveBalanceItem } from '@/lib/api/leave';
import { requestsApi } from '@/lib/api/requests';

interface Metric {
  primary: string;
  secondary: string;
  secondaryColor?: string;
}

const LOADING: Metric = { primary: '…', secondary: 'Loading' };
const UNAVAILABLE: Metric = { primary: '—', secondary: 'Unavailable right now' };

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

function clockedInMetric(day: AttendanceDayView): Metric {
  if (day.check_in && !day.check_out) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(day.check_in).getTime()) / 60000));
    return {
      primary: fmtTime(day.check_in),
      secondary: `Working since ${Math.floor(minutes / 60)}h ${minutes % 60}m`,
      secondaryColor: 'text-green-600 font-medium',
    };
  }
  if (day.check_in && day.check_out) {
    return { primary: fmtTime(day.check_out), secondary: `Clocked out (in at ${fmtTime(day.check_in)})` };
  }
  const why = day.is_holiday
    ? (day.holiday_name ?? 'Holiday')
    : day.on_leave
      ? `On ${day.leave_type_name ?? 'leave'}`
      : day.is_weekend
        ? 'Weekly off'
        : 'Not clocked in yet';
  return { primary: '—', secondary: why };
}

function leaveMetric(balances: LeaveBalanceItem[]): Metric {
  if (balances.length === 0) return { primary: '—', secondary: 'No leave balances set up yet' };
  const available = balances.reduce((sum, b) => sum + b.available, 0);
  return {
    primary: formatDays(available),
    secondary: `Days available across ${balances.length} leave type${balances.length === 1 ? '' : 's'}`,
  };
}

/** The four headline tiles, each from its own backend: today's attendance, leave
 *  balances, approvals awaiting the signed-in user, and their latest released
 *  payslip. A tile whose call fails says so instead of showing a made-up value. */
export function DashboardSummary() {
  const { user } = useAuth();
  const [clock, setClock] = useState<Metric>(LOADING);
  const [leave, setLeave] = useState<Metric>(LOADING);
  const [pending, setPending] = useState<Metric>(LOADING);
  const [pay, setPay] = useState<Metric>(LOADING);

  useEffect(() => {
    let active = true;
    const set = (setter: (m: Metric) => void) => (m: Metric) => active && setter(m);

    attendanceApi.getToday().then((d) => set(setClock)(clockedInMetric(d))).catch(() => set(setClock)(UNAVAILABLE));
    leaveApi.getBalance().then((b) => set(setLeave)(leaveMetric(b))).catch(() => set(setLeave)(UNAVAILABLE));

    fetch('/api/payroll/my/summary', { credentials: 'include' })
      .then((res) => res.json().then((body) => ({ ok: res.ok && body?.success, body })))
      .then(({ ok, body }) => {
        if (!ok) return set(setPay)(UNAVAILABLE);
        const slip = body.data?.latest_payslip;
        if (!slip) return set(setPay)({ primary: '—', secondary: 'No payslip released yet' });
        set(setPay)({
          primary: `₹${Number(slip.net_pay).toLocaleString('en-IN')}`,
          secondary: `Net pay · ${slip.period_label}`,
        });
      })
      .catch(() => set(setPay)(UNAVAILABLE));

    return () => {
      active = false;
    };
  }, []);

  // Requests routed to this user that are still undecided.
  useEffect(() => {
    if (!user) return;
    let active = true;
    requestsApi
      .list()
      .then((all) => {
        if (!active) return;
        const n = all.filter((r) => r.status === 'pending' && r.approver === String(user.id)).length;
        setPending({ primary: String(n), secondary: n === 1 ? 'Request awaiting your action' : 'Requests awaiting your action' });
      })
      .catch(() => active && setPending(UNAVAILABLE));
    return () => {
      active = false;
    };
  }, [user]);

  const cards = [
    {
      title: 'Clocked In',
      icon: <ClockIcon className="w-4 h-4" />,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      primaryValue: clock.primary,
      secondaryValue: clock.secondary,
      secondaryValueColor: clock.secondaryColor,
      actionLabel: 'View attendance',
      href: '/me/attendance',
    },
    {
      title: 'Leave Balance',
      icon: <CalendarIcon className="w-4 h-4" />,
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-600',
      primaryValue: leave.primary,
      secondaryValue: leave.secondary,
      actionLabel: 'View details',
      href: '/me/leaves',
    },
    {
      title: 'Pending Actions',
      icon: <ClipboardCheckIcon className="w-4 h-4" />,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      primaryValue: pending.primary,
      secondaryValue: pending.secondary,
      actionLabel: 'View all',
      href: '/inbox',
    },
    {
      title: 'Latest Payslip',
      icon: <WalletIcon className="w-4 h-4" />,
      iconBg: 'bg-indigo-50',
      iconColor: 'text-indigo-600',
      primaryValue: pay.primary,
      secondaryValue: pay.secondary,
      actionLabel: 'View payslips',
      href: '/payslips',
    },
  ];

  return (
    <div className="flex gap-4 overflow-x-auto pb-1 -mx-1 px-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
      {cards.map((card) => (
        <SummaryMetricCard key={card.title} {...card} />
      ))}
    </div>
  );
}
