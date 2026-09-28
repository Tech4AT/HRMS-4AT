'use client';

import { useEffect, useState } from 'react';
import { exitsApi, ExitsApiError, MyResignationState, RESIGNATION_STATUS_COLOR } from '@/lib/api/exits';
import { formatDate } from '@/lib/api/onboarding';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';

export function ResignationCard() {
  const [state, setState] = useState<MyResignationState | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');

  const load = async () => {
    try {
      const s = await exitsApi.mine();
      setState(s);
      if (s) setLastDay(s.suggestedLastDay);
    } catch {
      setState(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (state === undefined || state === null) return null;

  const r = state.resignation;
  const showCurrent = r && (r.status === 'submitted' || r.status === 'accepted' || r.status === 'completed');
  const today = new Date().toISOString().slice(0, 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('Please give a reason.');
      return;
    }
    setSubmitting(true);
    try {
      await exitsApi.resign({ reason: reason.trim(), requestedLastDay: lastDay });
      setOpen(false);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ExitsApiError ? err.message : 'Failed to submit resignation');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    setWithdrawing(true);
    setWithdrawError('');
    try {
      await exitsApi.withdraw();
      setConfirmWithdraw(false);
      await load();
    } catch (err) {
      setWithdrawError(err instanceof ExitsApiError ? err.message : 'Failed to withdraw');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="text-base font-bold text-slate-900 mb-1">Resignation</h3>

      {showCurrent && r ? (
        <div className="space-y-2">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${RESIGNATION_STATUS_COLOR[r.status]}`}>{r.statusDisplay}</span>
          <p className="text-sm text-gray-600">
            {r.status === 'submitted' && <>Submitted on {formatDate(r.submittedAt)}. Requested last working day: <strong>{formatDate(r.requestedLastDay)}</strong>.</>}
            {r.status === 'accepted' && <>Your last working day is <strong>{formatDate(r.lastWorkingDay)}</strong>. Your access ends after that day.</>}
            {r.status === 'completed' && <>You left on {formatDate(r.lastWorkingDay)}.</>}
          </p>
          {r.hrNotes && <p className="text-xs text-gray-500">HR: {r.hrNotes}</p>}
          {r.status === 'submitted' && (
            <button onClick={() => setConfirmWithdraw(true)} className="text-xs font-semibold text-purple-600 hover:underline">
              Withdraw resignation
            </button>
          )}
          {r.status === 'accepted' && <p className="text-xs text-gray-400">Need to change this? Please contact HR.</p>}
        </div>
      ) : (
        <>
          {r?.status === 'rejected' && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2 mb-3">
              Your previous resignation was not accepted{r.hrNotes ? `: ${r.hrNotes}` : '.'}
            </p>
          )}
          <p className="text-sm text-gray-500 mb-3">
            Your notice period is {state.noticePeriodDays} days. HR will review your resignation and confirm your last working day.
          </p>
          {!open ? (
            state.canResign && (
              <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-lg border border-red-300 text-red-600 font-semibold text-sm hover:bg-red-50">
                Resign
              </button>
            )
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 mb-1">Reason *</span>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Pursuing another opportunity"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 mb-1">Preferred last working day *</span>
                <input
                  type="date"
                  min={today}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600"
                  value={lastDay}
                  onChange={(e) => setLastDay(e.target.value)}
                />
                <span className="block text-[11px] text-gray-400 mt-1">
                  Based on your notice period: {formatDate(state.suggestedLastDay)}.
                </span>
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting || !lastDay} className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50">
                  {submitting ? 'Submitting…' : 'Submit resignation'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {confirmWithdraw && (
        <ConfirmDialog
          title="Withdraw your resignation?"
          description="HR will be able to see that you withdrew it. You'll continue in your role as normal."
          confirmLabel="Withdraw"
          loading={withdrawing}
          error={withdrawError}
          onCancel={() => {
            if (withdrawing) return;
            setConfirmWithdraw(false);
            setWithdrawError('');
          }}
          onConfirm={withdraw}
        />
      )}
    </div>
  );
}
