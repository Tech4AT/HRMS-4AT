'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { SectionTabs, type SectionTab } from '@/components/SectionTabs';
import { usePenalisations, type PenalisationRecord, type PenalisationStatus } from '@/lib/attendance/penalisation';
import {
  leaveApi,
  LeaveApiError,
  formatDays,
  formatDateRange,
  statusLabel as leaveStatusLabel,
  type LeaveRequest,
  type LeaveType,
} from '@/lib/api/leave';
import {
  attendanceApi,
  AttendanceApiError,
  type AttendanceRequest,
  type AttendanceRequestStatus,
} from '@/lib/api/attendance';

/* ============================== shared helpers ============================== */

function statusPillClass(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-700';
    case 'submitted':
      return 'bg-amber-100 text-amber-700';
    case 'rejected':
      return 'bg-red-100 text-red-700';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

const attendanceStatusLabel: Record<AttendanceRequestStatus, string> = {
  submitted: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateRange(start: string, end: string): string {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

/* ============================== generic section shell ============================== */

interface ApprovalSectionProps {
  title: string;
  emptyPendingLabel: string;
  emptyHistoryLabel: string;
  pending: {
    id: string;
    heading: string;
    detail: string;
  }[];
  history: {
    id: string;
    heading: string;
    detail: string;
    status: string;
    statusLabel: string;
    approverName?: string | null;
    approverRemarks?: string | null;
  }[];
  decidingId: string | null;
  rejectingId: string | null;
  rejectReason: string;
  onSetRejecting: (id: string | null) => void;
  onSetRejectReason: (v: string) => void;
  approvingId: string | null;
  approveRemarks: string;
  onSetApproving: (id: string | null) => void;
  onSetApproveRemarks: (v: string) => void;
  onDecide: (id: string, approve: boolean, remarks?: string) => void;
}

function ApprovalSection({
  title,
  emptyPendingLabel,
  emptyHistoryLabel,
  pending,
  history,
  decidingId,
  rejectingId,
  rejectReason,
  onSetRejecting,
  onSetRejectReason,
  approvingId,
  approveRemarks,
  onSetApproving,
  onSetApproveRemarks,
  onDecide,
}: ApprovalSectionProps) {
  const [view, setView] = useState<'pending' | 'history'>('pending');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            onClick={() => setView('pending')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              view === 'pending' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Pending{pending.length ? ` (${pending.length})` : ''}
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-200 transition-colors ${
              view === 'history' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            History
          </button>
        </div>
      </div>

      <div className="p-5">
        {view === 'pending' ? (
          pending.length === 0 ? (
            <p className="text-sm text-slate-400">{emptyPendingLabel}</p>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => (
                <div key={p.id} className="border border-slate-200 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{p.heading}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{p.detail}</p>
                    </div>
                    {rejectingId === p.id || approvingId === p.id ? null : (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            onSetApproving(p.id);
                            onSetApproveRemarks('');
                          }}
                          disabled={decidingId === p.id}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            onSetRejecting(p.id);
                            onSetRejectReason('');
                          }}
                          disabled={decidingId === p.id}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                  {approvingId === p.id ? (
                    <div className="flex items-center gap-2 mt-3">
                      <input
                        type="text"
                        value={approveRemarks}
                        onChange={(e) => onSetApproveRemarks(e.target.value)}
                        placeholder="Remarks (optional)"
                        className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                      />
                      <button
                        onClick={() => onDecide(p.id, true, approveRemarks.trim() || undefined)}
                        disabled={decidingId === p.id}
                        className="text-xs font-semibold px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Confirm approve
                      </button>
                      <button
                        onClick={() => onSetApproving(null)}
                        className="text-xs font-medium px-3 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {rejectingId === p.id ? (
                    <div className="flex items-center gap-2 mt-3">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => onSetRejectReason(e.target.value)}
                        placeholder="Reason for rejection (required)"
                        className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/10"
                      />
                      <button
                        onClick={() => onDecide(p.id, false)}
                        disabled={decidingId === p.id || rejectReason.trim().length === 0}
                        className="text-xs font-semibold px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Confirm reject
                      </button>
                      <button
                        onClick={() => onSetRejecting(null)}
                        className="text-xs font-medium px-3 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-400">{emptyHistoryLabel}</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{h.heading}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{h.detail}</p>
                  {h.approverRemarks ? (
                    <p className="text-xs text-slate-400 mt-0.5">Remarks: {h.approverRemarks}</p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-flex text-[11px] font-semibold rounded-full px-2.5 py-1 ${statusPillClass(h.status)}`}>
                    {h.statusLabel}
                  </span>
                  {h.approverName ? <p className="text-[11px] text-slate-400 mt-1">by {h.approverName}</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== penalisations ============================== */

const PENALISATION_FILTERS: { id: PenalisationStatus; label: string }[] = [
  { id: 'applied', label: 'Applied' },
  { id: 'overturn_requested', label: 'Overturn Requested' },
  { id: 'overturned', label: 'Overturned' },
];

interface PenalisationSectionProps {
  records: PenalisationRecord[];
  decidingId: string | null;
  rejectingId: string | null;
  rejectReason: string;
  onSetRejecting: (id: string | null) => void;
  onSetRejectReason: (v: string) => void;
  approvingId: string | null;
  approveRemarks: string;
  onSetApproving: (id: string | null) => void;
  onSetApproveRemarks: (v: string) => void;
  onDirectOverturn: (id: string) => void;
  onApproveOverturnRequest: (id: string, remarks?: string) => void;
  onRejectOverturnRequest: (id: string) => void;
}

/** Approvals > Penalisation. A penalisation applies automatically once the
 * regularisation grace period lapses, so there's no "pending" state to
 * review - the three filters here are just where a penalisation currently
 * stands: still Applied, an employee has asked HR to reconsider it (Overturn
 * Requested, via Leave Management), or it's been Overturned. HR can overturn
 * an Applied one directly, or approve/reject a pending request. */
function PenalisationSection({
  records,
  decidingId,
  rejectingId,
  rejectReason,
  onSetRejecting,
  onSetRejectReason,
  approvingId,
  approveRemarks,
  onSetApproving,
  onSetApproveRemarks,
  onDirectOverturn,
  onApproveOverturnRequest,
  onRejectOverturnRequest,
}: PenalisationSectionProps) {
  const [filter, setFilter] = useState<PenalisationStatus>('applied');
  const filtered = records.filter((r) => r.status === filter);

  const emptyLabel: Record<PenalisationStatus, string> = {
    applied: 'No applied penalisations.',
    overturn_requested: 'No overturn requests awaiting your review.',
    overturned: 'No overturned penalisations yet.',
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-base font-bold text-slate-900">Penalisations</h2>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {PENALISATION_FILTERS.map(({ id, label }, i) => {
            const count = records.filter((r) => r.status === id).length;
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
                  filter === id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
                {count ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-5">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">{emptyLabel[filter]}</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {r.employeeName} — Absent {fmtDate(r.absentDate)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {r.reason} · {r.daysOverdue} day(s) overdue
                    </p>
                    {filter === 'overturn_requested' ? (
                      <p className="text-xs text-slate-600 mt-1">
                        Requested {fmtDate(r.overturnRequestedOn!)} · {r.overturnRequestReason}
                      </p>
                    ) : null}
                    {filter === 'overturned' ? (
                      <p className="text-xs text-slate-400 mt-1">
                        Overturned by {r.overturnedBy}
                        {r.overturnedReason ? ` — ${r.overturnedReason}` : ''}
                      </p>
                    ) : null}
                  </div>

                  {filter === 'applied' && rejectingId !== r.id ? (
                    <button
                      onClick={() => {
                        onSetRejecting(r.id);
                        onSetRejectReason('');
                      }}
                      disabled={decidingId === r.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 shrink-0"
                    >
                      Overturn
                    </button>
                  ) : null}

                  {filter === 'overturn_requested' && rejectingId !== r.id && approvingId !== r.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          onSetApproving(r.id);
                          onSetApproveRemarks('');
                        }}
                        disabled={decidingId === r.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          onSetRejecting(r.id);
                          onSetRejectReason('');
                        }}
                        disabled={decidingId === r.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>

                {approvingId === r.id ? (
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={approveRemarks}
                      onChange={(e) => onSetApproveRemarks(e.target.value)}
                      placeholder="Remarks (optional)"
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
                    />
                    <button
                      onClick={() => onApproveOverturnRequest(r.id, approveRemarks.trim() || undefined)}
                      disabled={decidingId === r.id}
                      className="text-xs font-semibold px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Confirm approve
                    </button>
                    <button
                      onClick={() => onSetApproving(null)}
                      className="text-xs font-medium px-3 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                {rejectingId === r.id ? (
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => onSetRejectReason(e.target.value)}
                      placeholder={
                        filter === 'applied' ? 'Reason for overturning (required)' : 'Reason for rejecting this request (required)'
                      }
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/10"
                    />
                    <button
                      onClick={() => (filter === 'applied' ? onDirectOverturn(r.id) : onRejectOverturnRequest(r.id))}
                      disabled={decidingId === r.id || rejectReason.trim().length === 0}
                      className="text-xs font-semibold px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {filter === 'applied' ? 'Confirm overturn' : 'Confirm reject'}
                    </button>
                    <button
                      onClick={() => onSetRejecting(null)}
                      className="text-xs font-medium px-3 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== page ============================== */

type ApprovalTabId = 'wfh' | 'regularisation' | 'leave' | 'penalisation';

export default function ApprovalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoading: authLoading, hasPermission } = useAuth();
  const canApproveLeave = hasPermission('leave.approve');
  const canApproveAttendance = hasPermission('attendance.approve');
  const canApprove = canApproveLeave || canApproveAttendance;

  useEffect(() => {
    if (!authLoading && !canApprove) router.replace('/');
  }, [authLoading, canApprove, router]);

  // Order matches the product spec: WFH, Regularisation, Leave, Penalisation.
  // Penalisation has no permission of its own yet (not implemented on the
  // backend) - it's visible to anyone who can see Approvals at all.
  const tabs: SectionTab[] = [
    ...(canApproveAttendance ? [{ id: 'wfh', label: 'WFH', href: '/approvals?type=wfh' }] : []),
    ...(canApproveAttendance
      ? [{ id: 'regularisation', label: 'Regularisation', href: '/approvals?type=regularisation' }]
      : []),
    ...(canApproveLeave ? [{ id: 'leave', label: 'Leave', href: '/approvals?type=leave' }] : []),
    { id: 'penalisation', label: 'Penalisation', href: '/approvals?type=penalisation' },
  ];
  const requestedTab = searchParams.get('type');
  const activeTab: ApprovalTabId = (tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0]?.id) as ApprovalTabId;

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leavePending, setLeavePending] = useState<LeaveRequest[]>([]);
  const [leaveHistory, setLeaveHistory] = useState<LeaveRequest[]>([]);
  const [wfhPending, setWfhPending] = useState<AttendanceRequest[]>([]);
  const [wfhHistory, setWfhHistory] = useState<AttendanceRequest[]>([]);
  const [regPending, setRegPending] = useState<AttendanceRequest[]>([]);
  const [regHistory, setRegHistory] = useState<AttendanceRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveRemarks, setApproveRemarks] = useState('');

  // Sample-data only — penalisations aren't automated on the backend yet, so
  // decisions here just update this shared (localStorage-backed) state rather
  // than calling an API. See lib/attendance/penalisation.ts.
  const [penalisations, updatePenalisations] = usePenalisations();

  const refresh = useCallback(async () => {
    const tasks: Promise<unknown>[] = [];
    if (canApproveLeave) {
      tasks.push(leaveApi.getTypes().then(setLeaveTypes));
      tasks.push(leaveApi.getPendingApprovals().then(setLeavePending));
      tasks.push(leaveApi.getApprovalHistory().then(setLeaveHistory));
    }
    if (canApproveAttendance) {
      tasks.push(
        attendanceApi.getPendingApprovals().then((all) => {
          setWfhPending(all.filter((r) => r.request_type === 'wfh'));
          setRegPending(all.filter((r) => r.request_type === 'regularisation'));
        }),
      );
      tasks.push(
        attendanceApi.getApprovalHistory().then((all) => {
          setWfhHistory(all.filter((r) => r.request_type === 'wfh'));
          setRegHistory(all.filter((r) => r.request_type === 'regularisation'));
        }),
      );
    }
    await Promise.all(tasks);
  }, [canApproveLeave, canApproveAttendance]);

  useEffect(() => {
    if (!canApprove) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    refresh()
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load approvals');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canApprove, refresh]);

  const clearDecisionState = () => {
    setRejectingId(null);
    setRejectReason('');
    setApprovingId(null);
    setApproveRemarks('');
  };

  const decideLeave = async (id: string, approve: boolean, remarks?: string) => {
    setDecidingId(id);
    setActionError(null);
    setActionMessage(null);
    try {
      await leaveApi.decide(id, approve, approve ? undefined : rejectReason.trim(), remarks);
      setActionMessage(approve ? 'Leave request approved.' : 'Leave request rejected.');
      clearDecisionState();
      await refresh();
    } catch (e) {
      setActionError(e instanceof LeaveApiError ? e.message : 'Could not update this leave request');
    } finally {
      setDecidingId(null);
    }
  };

  const decideAttendance = async (id: string, approve: boolean, remarks?: string) => {
    setDecidingId(id);
    setActionError(null);
    setActionMessage(null);
    try {
      await attendanceApi.decideRequest(id, approve, approve ? undefined : rejectReason.trim(), remarks);
      setActionMessage(approve ? 'Request approved.' : 'Request rejected.');
      clearDecisionState();
      await refresh();
    } catch (e) {
      setActionError(e instanceof AttendanceApiError ? e.message : 'Could not update this request');
    } finally {
      setDecidingId(null);
    }
  };

  // A penalisation applies automatically once the regularisation grace period
  // lapses - there's no approval step. HR can overturn an Applied one
  // directly, or approve/reject a request the employee submitted themselves
  // from Leave Management.
  const directOverturnPenalisation = (id: string) => {
    updatePenalisations((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: 'overturned', overturnedBy: 'You', overturnedReason: rejectReason.trim() } : p,
      ),
    );
    setActionMessage('Penalisation overturned.');
    clearDecisionState();
  };

  const approveOverturnRequest = (id: string, remarks?: string) => {
    updatePenalisations((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status: 'overturned', overturnedBy: 'You', overturnedReason: remarks || p.overturnRequestReason }
          : p,
      ),
    );
    setActionMessage('Overturn request approved — penalisation overturned.');
    clearDecisionState();
  };

  const rejectOverturnRequest = (id: string) => {
    updatePenalisations((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: 'applied', overturnRequestReason: undefined, overturnRequestedOn: undefined } : p,
      ),
    );
    setActionMessage('Overturn request rejected — penalisation remains applied.');
    clearDecisionState();
  };

  const typeName = (r: LeaveRequest) => leaveTypes.find((t) => t.id === r.leave_type_id)?.name ?? r.leave_type_name ?? 'Leave';

  if (authLoading || !canApprove) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <SectionTabs tabs={tabs} active={activeTab} />
      <div className="p-4 sm:p-8 space-y-6">
        {(actionMessage || actionError) && (
          <div
            className={`rounded-lg text-sm px-4 py-3 ${
              actionError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {actionError || actionMessage}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500">Loading approvals…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : (
          <>
            {activeTab === 'leave' && canApproveLeave ? (
              <ApprovalSection
                title="Leave Requests"
                emptyPendingLabel="No leave requests awaiting your approval."
                emptyHistoryLabel="No decided leave requests yet."
                pending={leavePending.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — ${typeName(r)}`,
                  detail: `${formatDateRange(r.start_date, r.end_date, r.half_day_option)} · ${formatDays(r.duration_days)} day(s)${r.reason ? ` · ${r.reason}` : ''}`,
                }))}
                history={leaveHistory.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — ${typeName(r)}`,
                  detail: `${formatDateRange(r.start_date, r.end_date, r.half_day_option)} · ${formatDays(r.duration_days)} day(s)${
                    r.status === 'rejected' && r.rejection_reason ? ` · ${r.rejection_reason}` : ''
                  }`,
                  status: r.status,
                  statusLabel: leaveStatusLabel(r.status),
                  approverName: r.approver_name,
                  approverRemarks: r.approver_remarks,
                }))}
                decidingId={decidingId}
                rejectingId={rejectingId}
                rejectReason={rejectReason}
                onSetRejecting={setRejectingId}
                onSetRejectReason={setRejectReason}
                approvingId={approvingId}
                approveRemarks={approveRemarks}
                onSetApproving={setApprovingId}
                onSetApproveRemarks={setApproveRemarks}
                onDecide={decideLeave}
              />
            ) : null}

            {activeTab === 'wfh' && canApproveAttendance ? (
              <ApprovalSection
                title="Work From Home Requests"
                emptyPendingLabel="No Work From Home requests awaiting your approval."
                emptyHistoryLabel="No decided Work From Home requests yet."
                pending={wfhPending.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — Work From Home`,
                  detail: `${fmtDateRange(r.start_date, r.end_date)}${r.reason ? ` · ${r.reason}` : ''}`,
                }))}
                history={wfhHistory.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — Work From Home`,
                  detail: `${fmtDateRange(r.start_date, r.end_date)}${
                    r.status === 'rejected' && r.rejection_reason ? ` · ${r.rejection_reason}` : ''
                  }`,
                  status: r.status,
                  statusLabel: attendanceStatusLabel[r.status],
                  approverName: r.approver_name,
                  approverRemarks: r.approver_remarks,
                }))}
                decidingId={decidingId}
                rejectingId={rejectingId}
                rejectReason={rejectReason}
                onSetRejecting={setRejectingId}
                onSetRejectReason={setRejectReason}
                approvingId={approvingId}
                approveRemarks={approveRemarks}
                onSetApproving={setApprovingId}
                onSetApproveRemarks={setApproveRemarks}
                onDecide={decideAttendance}
              />
            ) : null}

            {activeTab === 'regularisation' && canApproveAttendance ? (
              <ApprovalSection
                title="Regularisation Requests"
                emptyPendingLabel="No regularisation requests awaiting your approval."
                emptyHistoryLabel="No decided regularisation requests yet."
                pending={regPending.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — Regularisation`,
                  detail: `${fmtDate(r.start_date)}${r.reason ? ` · ${r.reason}` : ''}`,
                }))}
                history={regHistory.map((r) => ({
                  id: r.id,
                  heading: `${r.employee_name || 'Employee'} — Regularisation`,
                  detail: `${fmtDate(r.start_date)}${
                    r.status === 'rejected' && r.rejection_reason ? ` · ${r.rejection_reason}` : ''
                  }`,
                  status: r.status,
                  statusLabel: attendanceStatusLabel[r.status],
                  approverName: r.approver_name,
                  approverRemarks: r.approver_remarks,
                }))}
                decidingId={decidingId}
                rejectingId={rejectingId}
                rejectReason={rejectReason}
                onSetRejecting={setRejectingId}
                onSetRejectReason={setRejectReason}
                approvingId={approvingId}
                approveRemarks={approveRemarks}
                onSetApproving={setApprovingId}
                onSetApproveRemarks={setApproveRemarks}
                onDecide={decideAttendance}
              />
            ) : null}

            {activeTab === 'penalisation' ? (
              <PenalisationSection
                records={penalisations}
                decidingId={decidingId}
                rejectingId={rejectingId}
                rejectReason={rejectReason}
                onSetRejecting={setRejectingId}
                onSetRejectReason={setRejectReason}
                approvingId={approvingId}
                approveRemarks={approveRemarks}
                onSetApproving={setApprovingId}
                onSetApproveRemarks={setApproveRemarks}
                onDirectOverturn={directOverturnPenalisation}
                onApproveOverturnRequest={approveOverturnRequest}
                onRejectOverturnRequest={rejectOverturnRequest}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
