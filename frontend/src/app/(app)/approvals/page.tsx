'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { AttendanceLeaveTabs } from '@/components/AttendanceLeaveTabs';
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

/* ============================== page ============================== */

export default function ApprovalsPage() {
  const router = useRouter();
  const { isLoading: authLoading, hasPermission } = useAuth();
  const canApproveLeave = hasPermission('leave.approve');
  const canApproveAttendance = hasPermission('attendance.approve');
  const canApprove = canApproveLeave || canApproveAttendance;

  useEffect(() => {
    if (!authLoading && !canApprove) router.replace('/');
  }, [authLoading, canApprove, router]);

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

  const typeName = (r: LeaveRequest) => leaveTypes.find((t) => t.id === r.leave_type_id)?.name ?? r.leave_type_name ?? 'Leave';

  if (authLoading || !canApprove) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <AttendanceLeaveTabs active="approvals" />
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
            {canApproveLeave ? (
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

            {canApproveAttendance ? (
              <>
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
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
