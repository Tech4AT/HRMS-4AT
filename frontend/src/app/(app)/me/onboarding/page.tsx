'use client';

import { useEffect, useState } from 'react';
import {
  onboardingApi,
  OnboardingApiError,
  MyOnboarding,
  OnboardingTask,
  TaskCategory,
  BankDetails,
  BankDetailsInput,
  STAGE_LABEL,
  STAGE_COLOR,
  TASK_STATUS_LABEL,
  formatDate,
} from '@/lib/api/onboarding';
import { documentsApi, DocumentsApiError, UploadedDocument } from '@/lib/api/documents';
import { CheckCircleIcon, FileTextIcon, XIcon } from '@/components/icons';
import { IdentityDocumentCards } from '@/components/documents/IdentityDocumentCards';
import { MyDocumentsList } from '@/components/documents/MyDocumentsList';
import { EducationRecordCards } from '@/components/documents/EducationRecordCards';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';

// Matched against onboarding/management/commands/seed_onboarding_templates.py
// and the backend's auto-complete-on-submit logic (services.py::
// auto_complete_task_by_title) — these two tasks are satisfied by the Bank
// Details / Identity Documents sections below, not a generic "mark done"
// click or a plain file upload.
const BANK_DETAILS_TASK_TITLE = 'add bank account details';
const IDENTITY_DOCS_TASK_TITLE = 'submit id proof';
const EDUCATION_TASK_TITLE = 'submit educational certificates';

export default function MyOnboardingPage() {
  const [data, setData] = useState<MyOnboarding | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadCount, setLoadCount] = useState(0);

  const load = async () => {
    try {
      setError(null);
      setData(await onboardingApi.getMine());
      setLoadCount((n) => n + 1);
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to load your onboarding checklist');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markStatus = async (taskId: number, status: 'in_progress' | 'done') => {
    setBusy(true);
    try {
      await onboardingApi.setTaskStatus(taskId, status);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to update task');
    } finally {
      setBusy(false);
    }
  };

  if (data === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 text-sm">You don&apos;t have an onboarding checklist. If you&apos;re a new hire, HR will set this up for you.</p>
        </div>
      </div>
    );
  }

  const categories: TaskCategory[] = data.stage === 'preboarding' ? ['preboarding'] : ['preboarding', 'onboarding'];

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-xl font-bold text-gray-900">Welcome, {data.employee.name.split(' ')[0]}!</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_COLOR[data.stage]}`}>
            {STAGE_LABEL[data.stage]}
          </span>
        </div>
        <p className="text-gray-500 text-sm mb-1">Joining date: {formatDate(data.joiningDate)}</p>
        {data.buddy && <p className="text-gray-500 text-sm">Your onboarding buddy: {data.buddy.name} ({data.buddy.workEmail})</p>}

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Your progress</span>
            <span>{data.progress.completed}/{data.progress.total} ({data.progress.percent}%)</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-600 rounded-full transition-all" style={{ width: `${data.progress.percent}%` }} />
          </div>
        </div>
      </div>

      <div id="identity-documents" className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 scroll-mt-4">
        <h3 className="font-bold text-gray-900 mb-1">Identity Documents</h3>
        <p className="text-xs text-gray-500 mb-4">Aadhaar, PAN and other government IDs. Visible only to you, HR, and Finance.</p>
        <IdentityDocumentCards employeeId={data.employee.id} onChanged={load} />
      </div>
      <div id="education" className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 scroll-mt-4">
        <h3 className="font-bold text-gray-900 mb-1">Degrees &amp; Certificates</h3>
        <p className="text-xs text-gray-500 mb-4">Your education details with a certificate for each. Visible only to you and HR.</p>
        <EducationRecordCards employeeId={data.employee.id} onChanged={load} />
      </div>
      <BankDetailsCard onSaved={load} />

      {categories.map((category) => {
        const tasks = data.tasks.filter((t) => t.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
        if (tasks.length === 0) return null;
        return (
          <div key={category} className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-4">{category === 'preboarding' ? 'Before you join' : 'Getting started'}</h3>
            <div className="space-y-2">
              {tasks.map((task) => {
                const isMine = task.owner === data.myOwnerRole;
                const done = task.status === 'done';
                const isBankDetailsTask = task.title.trim().toLowerCase() === BANK_DETAILS_TASK_TITLE;
                const isIdentityDocsTask = task.title.trim().toLowerCase() === IDENTITY_DOCS_TASK_TITLE;
                const isEducationTask = task.title.trim().toLowerCase() === EDUCATION_TASK_TITLE;
                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-lg border ${done ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-2.5">
                        {done ? (
                          <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0 mt-px" />
                        ) : (
                          <span className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0 mt-px" aria-hidden />
                        )}
                        <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-semibold text-sm ${done ? 'text-emerald-800' : 'text-gray-900'}`}>{task.title}</p>
                          {done && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">Completed</span>}
                          {!isMine && <span className="text-[11px] text-gray-400">Owned by {task.owner === 'hr_admin' ? 'HR' : task.owner === 'it_admin' ? 'IT' : task.owner}</span>}
                        </div>
                        {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                        <p className="text-xs text-gray-400 mt-1">
                          Due {formatDate(task.dueDate)}{done ? '' : ` · ${TASK_STATUS_LABEL[task.status]}`}
                        </p>
                        </div>
                      </div>

                      {isMine && !done && !task.requiresDocument && !isBankDetailsTask && (
                        <button
                          onClick={() => markStatus(task.id, 'done')}
                          disabled={busy}
                          className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline shrink-0"
                        >
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          Mark done
                        </button>
                      )}
                      {isMine && !done && isBankDetailsTask && (
                        <a href="#bank-details" className="text-xs font-semibold text-purple-600 hover:underline shrink-0">
                          Fill in bank details ↑
                        </a>
                      )}
                      {isMine && !done && isIdentityDocsTask && (
                        <a href="#identity-documents" className="text-xs font-semibold text-purple-600 hover:underline shrink-0">
                          Add identity documents ↑
                        </a>
                      )}
                    </div>

                    {isMine && !done && isEducationTask && (
                      <a href="#education" className="inline-block mt-2 text-xs font-semibold text-purple-600 hover:underline">
                        Add your qualifications ↑
                      </a>
                    )}
                    {isMine && task.requiresDocument && !isIdentityDocsTask && !isEducationTask && (
                      <TaskDocuments task={task} employeeId={data.employee.id} done={done} onSubmitted={load} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h3 className="font-bold text-gray-900 mb-1">My Documents</h3>
        <p className="text-xs text-gray-500 mb-4">Everything you&apos;ve submitted, plus your signed offer letter.</p>
        <MyDocumentsList employeeId={data.employee.id} refreshKey={loadCount} onChanged={load} />
      </div>
    </div>
  );
}

function TaskDocuments({
  task,
  employeeId,
  done,
  onSubmitted,
}: {
  task: OnboardingTask;
  employeeId: number;
  done: boolean;
  onSubmitted: () => void;
}) {
  const [docs, setDocs] = useState<UploadedDocument[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<UploadedDocument | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const load = async () => {
    try {
      setDocs(await documentsApi.list('onboarding_task', task.id));
    } catch {
      setDocs([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      await documentsApi.upload(file, 'onboarding_task', task.id, employeeId);
      await load();
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoveLoading(true);
    setRemoveError('');
    try {
      await documentsApi.remove(removeTarget.id);
      setRemoveTarget(null);
      await load();
    } catch (e) {
      setRemoveError(e instanceof DocumentsApiError ? e.message : 'Failed to remove document');
    } finally {
      setRemoveLoading(false);
    }
  };

  const markSubmitted = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onboardingApi.setTaskStatus(task.id, 'done');
      onSubmitted();
    } catch (e) {
      setSubmitError(e instanceof OnboardingApiError ? e.message : 'Failed to mark as submitted');
    } finally {
      setSubmitting(false);
    }
  };

  if (done && docs !== null && docs.length === 0) return null;

  return (
    <div className="mt-2.5 pl-0.5">
      {docs === null ? (
        <p className="text-xs text-gray-400">Loading files…</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
              <FileTextIcon className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              {doc.url ? (
                <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-gray-700 hover:text-purple-600 hover:underline truncate flex-1">
                  {doc.originalFilename}
                </a>
              ) : (
                <span className="text-xs text-gray-700 truncate flex-1">{doc.originalFilename}</span>
              )}
              {!done && (
                <button onClick={() => setRemoveTarget(doc)} className="text-gray-400 hover:text-red-600 shrink-0" title="Remove">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {docs.length === 0 && <p className="text-xs text-gray-400">No files uploaded yet.</p>}
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      {submitError && <p className="text-xs text-red-600 mt-1.5">{submitError}</p>}

      {!done && (
        <div className="flex items-center gap-3 mt-2">
          <label className="text-xs font-semibold text-purple-600 hover:underline cursor-pointer">
            {uploading ? 'Uploading…' : (docs && docs.length > 0) ? '+ Add another file' : 'Upload file'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload(file);
              }}
            />
          </label>
          {docs && docs.length > 0 && (
            <button
              onClick={markSubmitted}
              disabled={submitting}
              className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline"
            >
              <CheckCircleIcon className="w-3.5 h-3.5" />
              {submitting ? 'Submitting…' : 'Mark as submitted'}
            </button>
          )}
        </div>
      )}
      {removeTarget ? (
        <ConfirmDialog
          title="Delete Document?"
          description={`Are you sure you want to delete "${removeTarget.originalFilename}"? This action cannot be undone.`}
          tone="danger"
          confirmLabel="Delete"
          loading={removeLoading}
          error={removeError}
          onCancel={() => {
            if (removeLoading) return;
            setRemoveTarget(null);
            setRemoveError('');
          }}
          onConfirm={confirmRemove}
        />
      ) : null}
    </div>
  );
}

function BankDetailsCard({ onSaved }: { onSaved: () => void }) {
  const [existing, setExisting] = useState<BankDetails | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BankDetailsInput>({ accountHolderName: '', accountNumber: '', ifscCode: '', bankName: '', branchName: '' });
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await onboardingApi.getMyBankDetails();
      setExisting(data);
      if (data) {
        setForm({
          accountHolderName: data.accountHolderName, accountNumber: data.accountNumber ?? '',
          ifscCode: data.ifscCode, bankName: data.bankName, branchName: data.branchName,
        });
        setConfirmAccountNumber(data.accountNumber ?? '');
      }
    } catch {
      setExisting(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.accountHolderName.trim() || !form.accountNumber.trim()) {
      setError('Account holder name and account number are required.');
      return;
    }
    if (form.accountNumber.trim() !== confirmAccountNumber.trim()) {
      setError('Account numbers do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await onboardingApi.saveMyBankDetails(form);
      setEditing(false);
      await load();
      // The submit may have just auto-completed the "Add bank account
      // details" checklist item server-side (see services.py::
      // auto_complete_task_by_title) — this card's own `load()` only
      // re-fetches the bank details themselves, so the parent needs its
      // own nudge to pick up the new task status and progress numbers.
      onSaved();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to save bank details');
    } finally {
      setSubmitting(false);
    }
  };

  const showForm = editing || (existing !== undefined && existing === null);

  return (
    <div id="bank-details" className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 scroll-mt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-gray-900">Bank Account Details</h3>
        {existing && !editing && (
          <button onClick={() => setEditing(true)} className="text-purple-600 text-xs font-semibold hover:underline">
            Edit
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">For salary payments. Visible only to you, HR, and Finance.</p>

      {existing && !editing ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-gray-400">Account holder</dt>
            <dd className="text-gray-900 font-semibold">{existing.accountHolderName}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Account number</dt>
            <dd className="text-gray-900 font-semibold font-mono">{existing.accountNumberMasked}</dd>
          </div>
          {existing.ifscCode && (
            <div>
              <dt className="text-xs text-gray-400">IFSC code</dt>
              <dd className="text-gray-900">{existing.ifscCode}</dd>
            </div>
          )}
          {existing.bankName && (
            <div>
              <dt className="text-xs text-gray-400">Bank</dt>
              <dd className="text-gray-900">{existing.bankName}{existing.branchName ? ` · ${existing.branchName}` : ''}</dd>
            </div>
          )}
        </dl>
      ) : showForm ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account holder name *">
              <input className="input" value={form.accountHolderName} onChange={(e) => setForm((f) => ({ ...f, accountHolderName: e.target.value }))} />
            </Field>
            <Field label="Bank name">
              <input className="input" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account number *">
              <input className="input font-mono" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
            </Field>
            <Field label="Confirm account number *">
              <input className="input font-mono" value={confirmAccountNumber} onChange={(e) => setConfirmAccountNumber(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IFSC code">
              <input className="input uppercase" value={form.ifscCode} onChange={(e) => setForm((f) => ({ ...f, ifscCode: e.target.value }))} />
            </Field>
            <Field label="Branch">
              <input className="input" value={form.branchName} onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))} />
            </Field>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-1">
            {existing && (
              <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
                Cancel
              </button>
            )}
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50">
              {submitting ? 'Saving…' : 'Save Bank Details'}
            </button>
          </div>
          <style jsx global>{`
            #bank-details .input,
            #identity-documents .input {
              width: 100%;
              border: 1px solid #d1d5db;
              border-radius: 0.5rem;
              padding: 0.5rem 0.75rem;
              font-size: 0.875rem;
            }
            #bank-details .input:focus,
            #identity-documents .input:focus {
              outline: none;
              border-color: #9333ea;
            }
          `}</style>
        </form>
      ) : (
        <p className="text-xs text-gray-400">Loading…</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
