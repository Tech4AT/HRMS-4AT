'use client';

import { useState } from 'react';
import {
  TICKET_STATUSES,
  activityLabel,
  formatDateTime,
  type Ticket,
  type TicketStatus,
} from '@/lib/api/help';

/** Expanded ticket detail - the activity timeline is shared by both roles;
 * which action form renders below it depends on `mode` and the ticket's
 * current state (mirrors ESSL: an employee edits/reopens their own ticket,
 * a helper only ever changes status/assignment - see the ESSL investigation
 * for why there's no reassignment/priority-override or comment thread yet). */
export function TicketDetailPanel({
  ticket,
  mode,
  onEdit,
  onReopen,
  onUpdateStatus,
  onAssignToMe,
}: {
  ticket: Ticket;
  mode: 'employee' | 'admin';
  onEdit?: () => void;
  onReopen?: (reason: string) => Promise<void>;
  onUpdateStatus?: (status: TicketStatus, comment: string) => Promise<void>;
  onAssignToMe?: () => Promise<void>;
}) {
  const [reopenReason, setReopenReason] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [comment, setComment] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [assignBusy, setAssignBusy] = useState(false);

  const handleReopen = async () => {
    if (reopenReason.trim().length < 5 || !onReopen) return;
    setReopenBusy(true);
    setReopenError(null);
    try {
      await onReopen(reopenReason.trim());
      setReopenReason('');
    } catch (e) {
      setReopenError(e instanceof Error ? e.message : 'Could not reopen this ticket');
    } finally {
      setReopenBusy(false);
    }
  };

  const handleStatusSave = async () => {
    if (!onUpdateStatus) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await onUpdateStatus(status, comment.trim());
      setComment('');
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not update this ticket');
    } finally {
      setStatusBusy(false);
    }
  };

  const handleAssign = async () => {
    if (!onAssignToMe) return;
    setAssignBusy(true);
    try {
      await onAssignToMe();
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div className="px-5 pb-5 pt-1 space-y-4 bg-slate-50 border-t border-slate-100">
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.description}</p>

      {ticket.admin_comment ? (
        <div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <span className="font-semibold text-slate-800">Note from support: </span>
          {ticket.admin_comment}
        </div>
      ) : null}

      {/* Activity timeline */}
      <div>
        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Activity</h4>
        <ol className="space-y-2">
          {ticket.activities.map((a) => (
            <li key={a.id} className="flex items-start gap-3 text-xs">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
              <div>
                <p className="text-slate-700">
                  <span className="font-medium">{activityLabel(a)}</span>
                  {a.actor_name ? <span className="text-slate-400"> · {a.actor_name}</span> : null}
                </p>
                {a.comment ? <p className="text-slate-500 mt-0.5">{a.comment}</p> : null}
                <p className="text-slate-400 mt-0.5">{formatDateTime(a.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {mode === 'employee' && ticket.status !== 'Closed' ? (
        <div>
          <button
            onClick={onEdit}
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Edit ticket
          </button>
        </div>
      ) : null}

      {mode === 'employee' && ticket.status === 'Closed' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">Not fully resolved? Reopen this ticket</h4>
          <textarea
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            rows={2}
            placeholder="Tell us what's still wrong (minimum 5 characters)"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          {reopenError ? <p className="text-xs text-red-600">{reopenError}</p> : null}
          <button
            onClick={handleReopen}
            disabled={reopenBusy || reopenReason.trim().length < 5}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {reopenBusy ? 'Reopening…' : 'Reopen ticket'}
          </button>
        </div>
      ) : null}

      {mode === 'admin' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-900">Update ticket</h4>
            {ticket.assigned_to_id ? (
              <span className="text-xs text-slate-500">Assigned to {ticket.assigned_to_name}</span>
            ) : (
              <button
                onClick={handleAssign}
                disabled={assignBusy}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
              >
                {assignBusy ? 'Assigning…' : 'Assign to me'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Optional note for the requester"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          {statusError ? <p className="text-xs text-red-600">{statusError}</p> : null}
          <button
            onClick={handleStatusSave}
            disabled={statusBusy || (status === ticket.status && !comment.trim())}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {statusBusy ? 'Saving…' : status === 'Closed' ? 'Save & close ticket' : 'Save update'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
