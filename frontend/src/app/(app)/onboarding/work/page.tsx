'use client';

import { useEffect, useState } from 'react';
import {
  onboardingApi,
  OnboardingApiError,
  MyOnboardingWork,
  WorkRecord,
  WorkTask,
  TASK_STATUS_LABEL,
  IDENTITY_DOCUMENT_TYPE_LABEL,
  VERIFICATION_STATUS_COLOR,
  formatDate,
} from '@/lib/api/onboarding';
import { CheckCircleIcon, EyeIcon, EyeOffIcon, FileTextIcon } from '@/components/icons';

/** Workspace for people HR has assigned onboarding tasks to by name (e.g.
 * IT for laptop setup) or granted a data area (e.g. payroll → bank details). */
export default function OnboardingWorkPage() {
  const [data, setData] = useState<MyOnboardingWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    try {
      setError(null);
      setData(await onboardingApi.getMyWork());
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to load your onboarding tasks');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (task: WorkTask, status: 'in_progress' | 'done') => {
    setBusyId(task.id);
    try {
      await onboardingApi.setTaskStatus(task.id, status);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to update task');
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <div className="p-4 sm:p-8 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-4 sm:p-8 text-sm text-gray-500">Loading…</div>;

  const open = data.tasks.filter((t) => t.status !== 'done' && t.status !== 'skipped');
  const closed = data.tasks.filter((t) => t.status === 'done' || t.status === 'skipped');

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Onboarding tasks</h1>
        <p className="text-sm text-gray-500">Work HR has assigned to you for new hires, and data HR has shared with you.</p>
      </div>

      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-bold text-gray-900 mb-3">Assigned to you</h2>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing assigned to you.</p>
        ) : (
          <div className="space-y-2">
            {open.length === 0 && <p className="text-sm text-gray-500">All done — nothing open right now.</p>}
            {open.map((task) => (
              <div key={task.id} className="flex flex-wrap items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900 text-sm">{task.title}</p>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">{TASK_STATUS_LABEL[task.status]}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    For <strong>{task.employeeName}</strong> ({task.employeeCode}) · joins {formatDate(task.joiningDate)}
                  </p>
                  {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                  <p className="text-xs text-gray-400 mt-1">Due {formatDate(task.dueDate)}</p>
                </div>
                <div className="flex gap-3 shrink-0">
                  {task.status === 'pending' && (
                    <button onClick={() => setStatus(task, 'in_progress')} disabled={busyId === task.id} className="text-xs font-semibold text-blue-600 hover:underline">
                      Start
                    </button>
                  )}
                  <button
                    onClick={() => setStatus(task, 'done')}
                    disabled={busyId === task.id}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline"
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    Mark done
                  </button>
                </div>
              </div>
            ))}
            {closed.length > 0 && (
              <details className="pt-2">
                <summary className="text-xs text-gray-500 cursor-pointer">Completed ({closed.length})</summary>
                <div className="space-y-1.5 mt-2">
                  {closed.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 text-xs text-gray-600">
                      <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      {task.title} — {task.employeeName}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {data.areas.includes('bank_details') && (
        <SharedSection title="Bank details" records={data.records} render={(r) => <BankRow record={r} />} />
      )}
      {data.areas.includes('identity_documents') && (
        <SharedSection title="Identity documents" records={data.records} render={(r) => <IdentityRow record={r} />} />
      )}
      {data.areas.includes('education') && (
        <SharedSection title="Degrees & certificates" records={data.records} render={(r) => <EducationRow record={r} />} />
      )}
    </div>
  );
}

function SharedSection({ title, records, render }: { title: string; records: WorkRecord[]; render: (r: WorkRecord) => React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="font-bold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-400 mb-3">Shared with you by HR — read-only. Showing a full number is audited.</p>
      {records.length === 0 ? (
        <p className="text-sm text-gray-500">No new hires yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {records.map((r) => (
            <div key={r.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-semibold text-gray-900">
                {r.employeeName} <span className="text-xs font-normal text-gray-400">{r.employeeCode} · joins {formatDate(r.joiningDate)}</span>
              </p>
              <div className="mt-1.5">{render(r)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RevealToggle({ shown, busy, onClick }: { shown: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-gray-400 hover:text-purple-600 disabled:opacity-50"
      title={shown ? 'Hide number' : 'Show full number'}
      aria-label={shown ? 'Hide number' : 'Show full number'}
    >
      {shown ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

function BankRow({ record }: { record: WorkRecord }) {
  const bank = record.bankDetails;
  const [full, setFull] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!bank) return <p className="text-xs text-gray-400">Not submitted yet.</p>;

  const toggle = async () => {
    if (shown) return setShown(false);
    if (!full) {
      setBusy(true);
      try {
        const revealed = await onboardingApi.getBankDetails(record.id, true);
        setFull(revealed?.accountNumber ?? null);
      } catch (e) {
        alert(e instanceof OnboardingApiError ? e.message : 'Failed to reveal number');
        return;
      } finally {
        setBusy(false);
      }
    }
    setShown(true);
  };

  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
      <div><dt className="text-gray-400">Account holder</dt><dd className="text-gray-900">{bank.accountHolderName}</dd></div>
      <div>
        <dt className="text-gray-400">Account number</dt>
        <dd className="flex items-center gap-1.5 font-mono text-gray-900">
          {shown && full ? full : bank.accountNumberMasked}
          <RevealToggle shown={shown} busy={busy} onClick={toggle} />
        </dd>
      </div>
      <div><dt className="text-gray-400">IFSC</dt><dd className="text-gray-900">{bank.ifscCode || '—'}</dd></div>
      <div><dt className="text-gray-400">Bank</dt><dd className="text-gray-900">{[bank.bankName, bank.branchName].filter(Boolean).join(' · ') || '—'}</dd></div>
    </dl>
  );
}

function IdentityRow({ record }: { record: WorkRecord }) {
  const docs = record.identityDocuments ?? [];
  const [full, setFull] = useState<Record<number, string> | null>(null);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  if (docs.length === 0) return <p className="text-xs text-gray-400">Not submitted yet.</p>;

  const toggle = async (id: number) => {
    if (shown.has(id)) {
      setShown((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      return;
    }
    if (!full) {
      setBusy(true);
      try {
        const revealed = await onboardingApi.getIdentityDocuments(record.id, true);
        setFull(Object.fromEntries(revealed.filter((d) => d.documentNumber).map((d) => [d.id, d.documentNumber!])));
      } catch (e) {
        alert(e instanceof OnboardingApiError ? e.message : 'Failed to reveal number');
        return;
      } finally {
        setBusy(false);
      }
    }
    setShown((s) => new Set(s).add(id));
  };

  return (
    <div className="space-y-1.5">
      {docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-gray-900 w-28">{IDENTITY_DOCUMENT_TYPE_LABEL[d.documentType]}</span>
          <span className="flex items-center gap-1.5 font-mono text-gray-900">
            {shown.has(d.id) && full?.[d.id] ? full[d.id] : d.documentNumberMasked}
            <RevealToggle shown={shown.has(d.id)} busy={busy} onClick={() => toggle(d.id)} />
          </span>
          {d.fullName && <span className="text-gray-500">{d.fullName}</span>}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${VERIFICATION_STATUS_COLOR[d.verificationStatus]}`}>{d.verificationStatusDisplay}</span>
          {d.fileUrl && (
            <a href={d.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-purple-600 font-semibold hover:underline">
              <FileTextIcon className="w-3 h-3" /> Scan
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function EducationRow({ record }: { record: WorkRecord }) {
  const rows = record.educationRecords ?? [];
  if (rows.length === 0) return <p className="text-xs text-gray-400">Not submitted yet.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-gray-900">{[r.degree, r.branch].filter(Boolean).join(' — ')}</span>
          <span className="text-gray-600">{r.university}</span>
          {r.grade && <span className="text-gray-600">{parseFloat(r.grade) <= 10 ? `${r.grade} CGPA` : `${r.grade}%`}</span>}
          {r.yearOfCompletion && <span className="text-gray-400">{r.yearOfCompletion}</span>}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${VERIFICATION_STATUS_COLOR[r.verificationStatus]}`}>{r.verificationStatusDisplay}</span>
          {r.fileUrl && (
            <a href={r.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-purple-600 font-semibold hover:underline">
              <FileTextIcon className="w-3 h-3" /> Certificate
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
