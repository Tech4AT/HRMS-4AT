'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { exitsApi, ExitsApiError, Resignation, RESIGNATION_STATUS_COLOR } from '@/lib/api/exits';
import { formatDate } from '@/lib/api/onboarding';
import { PlusIcon } from '@/components/icons';

const TABS = [
  { id: 'submitted', label: 'Pending review' },
  { id: 'accepted', label: 'Serving notice' },
  { id: 'completed,rejected,withdrawn', label: 'Past' },
] as const;

interface EmployeeOption {
  id: number;
  name: string;
  employeeCode: string;
}

export default function ExitsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const isHrAdmin = user?.role === 'superadmin';
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('submitted');
  const [items, setItems] = useState<Resignation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ r: Resignation; action: 'accept' | 'reject' } | null>(null);
  const [initiating, setInitiating] = useState(false);

  useEffect(() => {
    if (!authLoading && !isHrAdmin) router.push('/');
  }, [authLoading, isHrAdmin, router]);

  const load = async () => {
    try {
      setError(null);
      setItems(null);
      setItems(await exitsApi.list(tab));
    } catch (e) {
      setError(e instanceof ExitsApiError ? e.message : 'Failed to load exits');
      setItems([]);
    }
  };

  useEffect(() => {
    if (isHrAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isHrAdmin]);

  if (authLoading || !isHrAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Exits</h1>
          <p className="text-sm text-gray-500">Review resignations and record employee exits.</p>
        </div>
        <button
          onClick={() => setInitiating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700"
        >
          <PlusIcon className="w-4 h-4" />
          Initiate exit
        </button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${tab === t.id ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {items === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500">Nothing here.</div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-900">{r.employee.name}</p>
                    <span className="text-xs text-gray-400">{r.employee.employeeCode}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${RESIGNATION_STATUS_COLOR[r.status]}`}>{r.statusDisplay}</span>
                    {r.initiatedByHr && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">HR-initiated</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[r.employee.designation, r.employee.department].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{r.reason}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Submitted {formatDate(r.submittedAt)} · Requested last day {formatDate(r.requestedLastDay)}
                    {r.lastWorkingDay ? ` · Confirmed last day ${formatDate(r.lastWorkingDay)}` : ''}
                    {r.decidedByName ? ` · Decided by ${r.decidedByName}` : ''}
                  </p>
                  {r.hrNotes && <p className="text-xs text-gray-500 mt-1">HR note: {r.hrNotes}</p>}
                </div>
                {r.status === 'submitted' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setDeciding({ r, action: 'reject' })}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => setDeciding({ r, action: 'accept' })}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700"
                    >
                      Accept
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {deciding && (
        <DecisionDialog
          resignation={deciding.r}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            load();
          }}
        />
      )}
      {initiating && (
        <InitiateExitDialog
          onClose={() => setInitiating(false)}
          onDone={() => {
            setInitiating(false);
            setTab('accepted');
            load();
          }}
        />
      )}
    </div>
  );
}

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600';

function DecisionDialog({
  resignation,
  action,
  onClose,
  onDone,
}: {
  resignation: Resignation;
  action: 'accept' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const [lastDay, setLastDay] = useState(resignation.requestedLastDay);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (action === 'reject' && !notes.trim()) {
      setError('Please give the employee a reason.');
      return;
    }
    setBusy(true);
    try {
      if (action === 'accept') await exitsApi.accept(resignation.id, { lastWorkingDay: lastDay, notes: notes.trim() });
      else await exitsApi.reject(resignation.id, notes.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ExitsApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          {action === 'accept' ? 'Accept resignation' : 'Reject resignation'} — {resignation.employee.name}
        </h2>
        <p className="text-xs text-gray-500 mb-4">The employee is emailed your decision.</p>
        <form onSubmit={submit} className="space-y-3">
          {action === 'accept' && (
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Last working day *</span>
              <input type="date" className={inputClass} value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
              <span className="block text-[11px] text-gray-400 mt-1">
                They requested {formatDate(resignation.requestedLastDay)}. Access ends after this day.
              </span>
            </label>
          )}
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">{action === 'accept' ? 'Note to employee (optional)' : 'Reason *'}</span>
            <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (action === 'accept' && !lastDay)}
              className={`flex-1 px-4 py-2 rounded-lg text-white font-semibold text-sm disabled:opacity-50 ${action === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {busy ? 'Saving…' : action === 'accept' ? 'Accept' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InitiateExitDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/employees/lookup', { credentials: 'include' })
      .then((r) => r.json())
      .then((b) => setEmployees(b?.success ? b.data : []))
      .catch(() => setEmployees([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!employeeId || !lastDay || !reason.trim()) {
      setError('Employee, last working day and reason are all required.');
      return;
    }
    setBusy(true);
    try {
      await exitsApi.initiate({ employeeId: Number(employeeId), lastWorkingDay: lastDay, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ExitsApiError ? err.message : 'Failed to record exit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Initiate exit</h2>
        <p className="text-xs text-gray-500 mb-4">
          For exits HR starts (contract end, termination…). The employee is emailed, and their access ends after the last working day.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Employee *</span>
            <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select an employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Last working day *</span>
            <input type="date" className={inputClass} value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Reason *</span>
            <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Contract ended" />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Record exit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
