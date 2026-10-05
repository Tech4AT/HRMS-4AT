'use client';

import { formatDateList, formatDays, statusLabel, type CompOffRequest, type LeaveStatus } from '@/lib/api/leave';

function pillClass(status: LeaveStatus): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-700';
    case 'submitted':
      return 'bg-amber-100 text-amber-700';
    case 'rejected':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

/** The caller's own Comp Off requests, newest first, with Cancel on pending ones. */
export function CompOffRequestsCard({
  requests,
  cancellingId,
  onCancel,
}: {
  requests: CompOffRequest[];
  cancellingId: string | null;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-base font-bold text-slate-900 mb-3">Comp Off requests</h2>
      {requests.length === 0 ? (
        <p className="text-sm text-slate-400">
          You haven&apos;t requested any Comp Off yet. Worked on a weekly off or holiday? Use Request Comp Off.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {formatDays(r.days)} day(s){r.leave_type_name ? ` → ${r.leave_type_name}` : ''}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Worked: {formatDateList(r.worked_dates)}</p>
                  {r.reason ? <p className="text-xs text-slate-400 mt-0.5">{r.reason}</p> : null}
                  {r.status === 'rejected' && r.rejection_reason ? (
                    <p className="text-xs text-red-500 mt-0.5">Rejected: {r.rejection_reason}</p>
                  ) : null}
                  {r.status === 'approved' && r.approver_remarks ? (
                    <p className="text-xs text-slate-400 mt-0.5">Note: {r.approver_remarks}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${pillClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.status === 'submitted' ? (
                    <button
                      onClick={() => onCancel(r.id)}
                      disabled={cancellingId === r.id}
                      className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      {cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
