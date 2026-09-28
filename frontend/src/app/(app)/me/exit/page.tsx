'use client';

import { useEffect, useState } from 'react';
import { exitsApi, ExitsApiError, MyResignationState, RESIGNATION_STATUS_COLOR, ResignationStatus } from '@/lib/api/exits';
import { formatDate } from '@/lib/api/onboarding';

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500';

const STATUS_LABEL: Record<ResignationStatus, string> = {
  submitted: 'Pending HR review',
  accepted: 'Accepted — serving notice',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  completed: 'Exit completed',
};

export default function MyExitPage() {
  const [state, setState] = useState<MyResignationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [requestedLastDay, setRequestedLastDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await exitsApi.mine();
      setState(data ?? { resignation: null, noticePeriodDays: 30, suggestedLastDay: '', canResign: true });
    } catch (e) {
      setError(e instanceof ExitsApiError ? e.message : 'Failed to load exit information');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (state?.suggestedLastDay) setRequestedLastDay(state.suggestedLastDay);
  }, [state?.suggestedLastDay]);

  const handleResign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!reason.trim()) { setSubmitError('Please provide a reason.'); return; }
    if (!requestedLastDay) { setSubmitError('Please select your requested last working day.'); return; }
    setBusy(true);
    try {
      await exitsApi.resign({ reason: reason.trim(), requestedLastDay });
      setShowForm(false);
      setReason('');
      await load();
    } catch (e) {
      setSubmitError(e instanceof ExitsApiError ? e.message : 'Failed to submit resignation');
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!confirm('Are you sure you want to withdraw your resignation?')) return;
    setBusy(true);
    try {
      await exitsApi.withdraw();
      await load();
    } catch (e) {
      setError(e instanceof ExitsApiError ? e.message : 'Failed to withdraw resignation');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;

  const { resignation, noticePeriodDays, canResign } = state!;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8 max-w-2xl">
      {!resignation && !showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Submit Resignation</h2>
              <p className="text-sm text-gray-500">Notice period: {noticePeriodDays} days</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Once submitted, your resignation will be reviewed by HR. You can withdraw it before HR makes a decision.
          </p>
          {canResign ? (
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700"
            >
              Submit Resignation
            </button>
          ) : (
            <p className="text-sm text-amber-600 font-medium">You are currently not eligible to resign.</p>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Submit Resignation</h2>
          <p className="text-xs text-gray-500 mb-5">Your notice period is {noticePeriodDays} days. HR will review and confirm your last working day.</p>
          <form onSubmit={handleResign} className="space-y-4">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Reason for leaving *</span>
              <textarea
                className={inputClass}
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Please provide your reason for resigning…"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Requested last working day *</span>
              <input
                type="date"
                className={inputClass}
                value={requestedLastDay}
                onChange={(e) => setRequestedLastDay(e.target.value)}
              />
              {state?.suggestedLastDay && (
                <span className="block text-[11px] text-gray-400 mt-1">
                  Suggested based on notice period: {formatDate(state.suggestedLastDay)}
                </span>
              )}
            </label>
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setSubmitError(null); }}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit Resignation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resignation && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">Resignation</h2>
                <p className="text-xs text-gray-500">Submitted {formatDate(resignation.submittedAt)}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${RESIGNATION_STATUS_COLOR[resignation.status]}`}>
                {STATUS_LABEL[resignation.status]}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</span>
                <p className="text-gray-800 mt-0.5 whitespace-pre-line">{resignation.reason}</p>
              </div>
              <div className="flex gap-8 pt-1">
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested last day</span>
                  <p className="text-gray-800 mt-0.5">{formatDate(resignation.requestedLastDay)}</p>
                </div>
                {resignation.lastWorkingDay && (
                  <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Confirmed last day</span>
                    <p className="text-gray-800 mt-0.5">{formatDate(resignation.lastWorkingDay)}</p>
                  </div>
                )}
              </div>
              {resignation.decidedByName && (
                <p className="text-xs text-gray-400 pt-1">
                  Decided by {resignation.decidedByName} on {formatDate(resignation.decidedAt!)}
                </p>
              )}
              {resignation.hrNotes && (
                <div className="bg-gray-50 rounded-lg p-3 mt-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">HR Note</span>
                  <p className="text-sm text-gray-700 mt-0.5">{resignation.hrNotes}</p>
                </div>
              )}
            </div>

            {resignation.status === 'submitted' && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-3">Your resignation is pending HR review. You may withdraw it at any time before a decision is made.</p>
                <button
                  onClick={handleWithdraw}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {busy ? 'Processing…' : 'Withdraw Resignation'}
                </button>
              </div>
            )}
          </div>

          {resignation.status === 'accepted' && resignation.lastWorkingDay && (
            <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5">
              <p className="text-sm font-semibold text-blue-800">Your resignation has been accepted.</p>
              <p className="text-sm text-blue-700 mt-1">Your confirmed last working day is <strong>{formatDate(resignation.lastWorkingDay)}</strong>. Please ensure all handover tasks are completed before then.</p>
            </div>
          )}

          {resignation.status === 'rejected' && (
            <div className="bg-red-50 rounded-2xl border border-red-200 p-5">
              <p className="text-sm font-semibold text-red-800">Your resignation was not accepted.</p>
              {resignation.hrNotes && <p className="text-sm text-red-700 mt-1">{resignation.hrNotes}</p>}
              {canResign && (
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-3 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700"
                >
                  Submit New Resignation
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
