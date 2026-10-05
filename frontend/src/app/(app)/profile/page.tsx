'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { Employee360, type ExtraTab } from '@/components/employee360/Employee360';
import { PackageIcon } from '@/components/icons';
import { LearningOverview } from '@/components/learning/LearningOverview';
import { exitsApi, ExitsApiError, MyResignationState, RESIGNATION_STATUS_COLOR, ResignationStatus } from '@/lib/api/exits';

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] py-20 flex flex-col items-center text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h2 className="text-base font-bold text-slate-900 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 max-w-sm">{description}</p>
    </div>
  );
}

const RESIGN_STATUS_LABEL: Record<ResignationStatus, string> = {
  submitted: 'Pending HR review',
  accepted: 'Accepted — serving notice',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  completed: 'Exit completed',
};

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ExitTab() {
  const [exitState, setExitState] = useState<MyResignationState | null>(null);
  const [exitLoading, setExitLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [requestedLastDay, setRequestedLastDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = async () => {
    setExitLoading(true);
    try {
      const data = await exitsApi.mine();
      const resolved = data ?? { resignation: null, noticePeriodDays: 30, suggestedLastDay: '', canResign: true };
      setExitState(resolved);
      if (resolved.suggestedLastDay) setRequestedLastDay(resolved.suggestedLastDay);
    } catch {
      setExitState({ resignation: null, noticePeriodDays: 30, suggestedLastDay: '', canResign: true });
    } finally {
      setExitLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    } finally {
      setBusy(false);
    }
  };

  if (exitLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  const resignation = exitState?.resignation ?? null;
  const noticePeriodDays = exitState?.noticePeriodDays ?? 30;
  const canResign = exitState?.canResign ?? true;
  const suggestedLastDay = exitState?.suggestedLastDay ?? '';
  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400';

  return (
    <div className="max-w-2xl space-y-4">
      {!resignation && !showForm && (
        <DashboardCard title="Resignation">
          <p className="text-sm text-slate-600 mb-4">
            Your notice period is <strong>{noticePeriodDays} days</strong>. Once submitted, your resignation goes to HR for review. You can withdraw it before a decision is made.
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
        </DashboardCard>
      )}

      {showForm && (
        <DashboardCard title="Submit Resignation">
          <form onSubmit={handleResign} className="space-y-4">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Reason for leaving *</span>
              <textarea className={inputCls} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Please provide your reason for resigning…" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Requested last working day *</span>
              <input type="date" className={inputCls} value={requestedLastDay} onChange={(e) => setRequestedLastDay(e.target.value)} />
              {suggestedLastDay && (
                <span className="block text-[11px] text-slate-400 mt-1">Suggested (based on notice period): {fmtShort(suggestedLastDay)}</span>
              )}
            </label>
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowForm(false); setSubmitError(null); }}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50">
                {busy ? 'Submitting…' : 'Submit Resignation'}
              </button>
            </div>
          </form>
        </DashboardCard>
      )}

      {resignation && (
        <DashboardCard title="Resignation">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <p className="text-xs text-slate-400">Submitted {fmtShort(resignation.submittedAt)}</p>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${RESIGNATION_STATUS_COLOR[resignation.status as ResignationStatus]}`}>
              {RESIGN_STATUS_LABEL[resignation.status as ResignationStatus]}
            </span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Reason</p>
              <p className="text-sm text-slate-800 whitespace-pre-line">{resignation.reason}</p>
            </div>
            <div className="flex gap-8">
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Requested last day</p>
                <p className="text-sm font-semibold text-slate-900">{fmtShort(resignation.requestedLastDay)}</p>
              </div>
              {resignation.lastWorkingDay && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Confirmed last day</p>
                  <p className="text-sm font-semibold text-slate-900">{fmtShort(resignation.lastWorkingDay)}</p>
                </div>
              )}
            </div>
            {resignation.hrNotes && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">HR Note</p>
                <p className="text-sm text-slate-700">{resignation.hrNotes}</p>
              </div>
            )}
            {resignation.decidedByName && (
              <p className="text-xs text-slate-400">Decided by {resignation.decidedByName} on {fmtShort(resignation.decidedAt!)}</p>
            )}
          </div>
          {resignation.status === 'submitted' && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-3">Your resignation is pending HR review. You may withdraw it before a decision is made.</p>
              <button onClick={handleWithdraw} disabled={busy}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 disabled:opacity-50">
                {busy ? 'Processing…' : 'Withdraw Resignation'}
              </button>
            </div>
          )}
          {resignation.status === 'accepted' && resignation.lastWorkingDay && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-sm font-semibold text-blue-800">Your resignation has been accepted.</p>
              <p className="text-sm text-blue-700 mt-1">Your confirmed last working day is <strong>{fmtShort(resignation.lastWorkingDay)}</strong>. Please ensure all handover tasks are completed.</p>
            </div>
          )}
          {resignation.status === 'rejected' && canResign && (
            <div className="mt-4">
              <button onClick={() => setShowForm(true)}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700">
                Submit New Resignation
              </button>
            </div>
          )}
        </DashboardCard>
      )}
    </div>
  );
}

const SELF_TABS: ExtraTab[] = [
  { id: 'learning', label: 'Learning', content: <LearningOverview employeeId="me" showLaunch /> },
  { id: 'exit', label: 'Exit', content: <ExitTab /> },
  {
    id: 'assets',
    label: 'Assets',
    content: (
      <EmptyPanel
        icon={<PackageIcon className="w-7 h-7" />}
        title="No Assets"
        description="Laptops, badges, and other assigned assets will appear here."
      />
    ),
  },
];

/** The signed-in user's own profile: the shared Employee 360 (About, Profile, Job)
 *  plus the tabs that only make sense for yourself (Exit, Assets). */
export default function ProfilePage() {
  const tab = useSearchParams().get('tab');
  return <Employee360 employeeId="me" extraTabs={SELF_TABS} defaultTab={tab ?? 'about'} />;
}
