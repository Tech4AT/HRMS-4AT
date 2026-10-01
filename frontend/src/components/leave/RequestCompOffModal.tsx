'use client';

import { useEffect, useState } from 'react';
import { formatDays, leaveApi, LeaveApiError, type EligibleCompOffDays } from '@/lib/api/leave';

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Request Comp Off: pick the off days (weekly offs / holidays) you worked, add an
 *  optional reason, and submit for approval. Once approved, one day per selected
 *  date is added to the leave type shown in the summary. */
export function RequestCompOffModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  /** Called after a successful submit, with the number of days requested. */
  onSubmitted: (days: number) => void;
}) {
  const [eligible, setEligible] = useState<EligibleCompOffDays | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    leaveApi
      .getEligibleCompOffDays()
      .then((d) => active && setEligible(d))
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : 'Could not load your off days'));
    return () => {
      active = false;
    };
  }, []);

  const toggle = (date: string) =>
    setSelected((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await leaveApi.createCompOffRequest({
        worked_dates: selected,
        reason: reason.trim() || undefined,
      });
      onSubmitted(created.days);
    } catch (e) {
      setSubmitError(e instanceof LeaveApiError ? e.message : 'Could not submit this request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Request Comp Off</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-gray-600">
            Select the weekly-off days and holidays you worked. Each day you select earns one Comp Off once your manager
            approves it.
          </p>

          {loadError ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
          ) : eligible === null ? (
            <p className="text-sm text-gray-500">Loading your off days…</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Days you worked</label>
                {eligible.days.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    You have no off days in the last {eligible.lookback_days} days that can be claimed.
                  </p>
                ) : (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                    {eligible.days.map((d) => (
                      <label
                        key={d.date}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(d.date)}
                          onChange={() => toggle(d.date)}
                          className="rounded border-gray-300"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-gray-900">{fmtDay(d.date)}</span>
                          <span className="block text-xs text-gray-500">{d.reason}</span>
                        </span>
                        {d.clocked_in ? (
                          <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 shrink-0">
                            Clocked in
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-center">
                <span className="text-sm font-medium text-gray-700 bg-gray-50 px-3 py-1 rounded-lg">
                  {formatDays(selected.length)} day(s) selected
                </span>
              </div>

              <p className="text-center text-[11px] text-gray-400 -mt-2">
                Your approver chooses which leave balance these days are added to.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What did you work on? (optional)"
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </>
          )}

          {submitError ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</div>
          ) : null}
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || selected.length === 0}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {submitting ? 'Submitting…' : 'Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
