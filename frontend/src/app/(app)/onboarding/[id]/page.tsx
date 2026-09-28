'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';
import {
  onboardingApi,
  OnboardingApiError,
  OnboardingRecord,
  OnboardingTask,
  TaskStatus,
  TaskCategory,
  TaskOwner,
  BankDetails,
  IdentityDocument,
  IDENTITY_DOCUMENT_TYPE_LABEL,
  EducationRecord,
  EmployeeLetterRecord,
  EmployeeLetterType,
  EMPLOYEE_LETTER_TYPE_LABEL,
  STAGE_LABEL,
  STAGE_COLOR,
  OWNER_LABEL,
  TASK_STATUS_LABEL,
  OFFER_STATUS_LABEL,
  OFFER_STATUS_COLOR,
  REJECTION_REASON_LABEL,
  offerNextAction,
  BGV_STATUS_LABEL,
  BGV_STATUS_COLOR,
  formatDate,
  formatDateTime,
  formatCurrency,
} from '@/lib/api/onboarding';
import { documentsApi, DocumentsApiError, UploadedDocument } from '@/lib/api/documents';
import { ChevronLeftIcon, PlusIcon, CheckCircleIcon, MailIcon, DownloadIcon, FingerprintIcon, FileTextIcon, XIcon, EyeIcon, EyeOffIcon } from '@/components/icons';
import { DocumentStatusBadge, type DocumentDisplayStatus } from '@/components/documents/DocumentStatusBadge';
import { DocumentViewerModal, type ViewableDocument } from '@/components/documents/DocumentViewerModal';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';
import { DocumentActionMenu, type DocumentActionMenuItem } from '@/components/documents/DocumentActionMenu';
import { DocumentDetailsDrawer, type DocumentDetailsData } from '@/components/documents/DocumentDetailsDrawer';
import { ExpiryIndicator } from '@/components/documents/ExpiryIndicator';

const OFFER_PENDING_STATUSES = ['sent', 'viewed', 'awaiting_signature'];
const OFFER_DRAFT_STATUSES = ['draft', 'generated'];
const IDENTITY_DOCS_TASK_TITLE = 'submit id proof';

const STATUS_PILL: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-gray-200 text-gray-500 line-through',
};

export default function OnboardingRecordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const recordId = Number(params.id);

  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showEditEmail, setShowEditEmail] = useState(false);

  const isHrAdmin = user?.role === 'superadmin';
  const hasAccess = !!user && (user.role === 'admin' || user.role === 'superadmin');

  useEffect(() => {
    if (!authLoading && !hasAccess) router.push('/');
  }, [authLoading, hasAccess, router]);

  const load = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setRecord(await onboardingApi.getRecord(recordId));
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to load onboarding record');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !hasAccess || !recordId) return;
    load();
  }, [authLoading, hasAccess, recordId]);

  const canActOnTask = (task: OnboardingTask) => isHrAdmin || task.owner === 'manager';

  const [assigneeOptions, setAssigneeOptions] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!isHrAdmin) return;
    fetch('/api/employees/lookup', { credentials: 'include' })
      .then((r) => r.json())
      .then((b) => setAssigneeOptions(b?.success ? b.data : []))
      .catch(() => setAssigneeOptions([]));
  }, [isHrAdmin]);

  const assignTask = async (taskId: number, assigneeId: number | null) => {
    setBusy(true);
    try {
      await onboardingApi.setTaskAssignee(taskId, assigneeId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to assign task');
    } finally {
      setBusy(false);
    }
  };

  const setTaskStatus = async (taskId: number, status: TaskStatus) => {
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

  const removeTask = async (taskId: number) => {
    if (!confirm('Remove this task?')) return;
    setBusy(true);
    try {
      await onboardingApi.removeTask(taskId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to remove task');
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!confirm('Mark onboarding as fully complete?')) return;
    setBusy(true);
    try {
      await onboardingApi.complete(recordId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to complete');
    } finally {
      setBusy(false);
    }
  };

  const sendOfferLetter = async () => {
    if (!confirm('Email the offer letter to this candidate now? You can cancel it afterward if you need to.')) return;
    setBusy(true);
    try {
      await onboardingApi.sendOfferLetter(recordId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to send offer letter');
    } finally {
      setBusy(false);
    }
  };

  const resendOfferLetter = async () => {
    if (!confirm('Resend this offer letter? The previous signing link stops working immediately.')) return;
    setBusy(true);
    try {
      await onboardingApi.resendOfferLetter(recordId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to resend offer letter');
    } finally {
      setBusy(false);
    }
  };

  const cancelOfferLetter = async () => {
    if (!confirm('Undo this offer? The candidate’s signing link will stop working immediately. You can send a new one afterward.')) return;
    setBusy(true);
    try {
      await onboardingApi.cancelOfferLetter(recordId);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to cancel offer letter');
    } finally {
      setBusy(false);
    }
  };

  const extendOfferLetter = async () => {
    const days = prompt('Extend the signing deadline by how many days?', '3');
    if (!days) return;
    const additionalHours = Number(days) * 24;
    if (!additionalHours || additionalHours <= 0) return;
    setBusy(true);
    try {
      await onboardingApi.extendOfferLetter(recordId, additionalHours);
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to extend offer letter');
    } finally {
      setBusy(false);
    }
  };

  const [bgvNotes, setBgvNotes] = useState('');

  const decideBgv = async (status: 'passed' | 'failed') => {
    if (!confirm(`Mark background verification as ${status}? This records your decision and can't be automated back.`)) return;
    setBusy(true);
    try {
      await onboardingApi.decideBackgroundVerification(recordId, status, bgvNotes);
      setBgvNotes('');
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to record decision');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || !hasAccess) return null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
      <Link href="/onboarding" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600 mb-4">
        <ChevronLeftIcon className="w-4 h-4" />
        Back to Onboarding
      </Link>

      {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
      {error && !isLoading && <p className="text-red-600 text-sm">{error}</p>}

      {!isLoading && !error && record && (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-xl font-bold text-gray-900">{record.employee.name}</h1>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_COLOR[record.stage]}`}>
                    {STAGE_LABEL[record.stage]}
                  </span>
                </div>
                <p className="text-gray-500 text-sm flex items-center gap-2 flex-wrap">
                  <span>{record.employee.workEmail} · {record.employee.employeeCode}</span>
                  {isHrAdmin && (
                    <button
                      type="button"
                      onClick={() => setShowEditEmail(true)}
                      className="text-purple-600 text-xs font-semibold hover:underline"
                    >
                      Edit email
                    </button>
                  )}
                </p>
                {record.employee.personalEmail && (
                  <p className="text-gray-400 text-xs mt-0.5">Personal: {record.employee.personalEmail}</p>
                )}
                <p className="text-gray-500 text-sm mt-1">Joining date: {formatDate(record.joiningDate)}</p>
                <p className="text-gray-500 text-sm">Buddy: {record.buddy ? record.buddy.name : 'Not assigned'}</p>
              </div>

              {isHrAdmin && (
                <div className="flex gap-2">
                  {record.stage === 'preboarding' && record.offerLetter?.status === 'accepted' && (
                    <span className="px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold self-center">
                      Moves to Onboarding automatically once every required preboarding step is done
                    </span>
                  )}
                  {record.stage === 'preboarding' && record.offerLetter && record.offerLetter.status !== 'accepted' && (
                    <span className="px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold self-center">
                      Waiting for the candidate to accept their offer
                    </span>
                  )}
                  {record.stage === 'onboarding' && (
                    <button
                      onClick={complete}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Complete Onboarding
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Required checklist progress</span>
                <span>{record.progress.completed}/{record.progress.total} ({record.progress.percent}%)</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 rounded-full transition-all"
                  style={{ width: `${record.progress.percent}%` }}
                />
              </div>
            </div>
          </div>

          {record.offerLetter && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900">Offer Letter</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${OFFER_STATUS_COLOR[record.offerLetter.status]}`}>
                      {OFFER_STATUS_LABEL[record.offerLetter.status]}
                    </span>
                    <span className="text-xs text-gray-400">{record.offerLetter.offerNumber} · v{record.offerLetter.version}</span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {formatCurrency(record.offerLetter.annualCtc, record.offerLetter.currency)} / year ·{' '}
                    {record.offerLetter.employmentTypeDisplay} · {record.offerLetter.probationPeriodMonths}-month probation
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Basic {formatCurrency(record.offerLetter.basicSalary, record.offerLetter.currency)} · HRA{' '}
                    {formatCurrency(record.offerLetter.hra, record.offerLetter.currency)} · Other allowances{' '}
                    {formatCurrency(record.offerLetter.otherAllowances, record.offerLetter.currency)} · Other components{' '}
                    {formatCurrency(record.offerLetter.otherComponents, record.offerLetter.currency)}
                  </p>
                  {record.offerLetter.templateName && (
                    <p className="text-xs text-gray-400 mt-0.5">Template: {record.offerLetter.templateName}</p>
                  )}

                  <p className="text-xs text-gray-500 mt-2">Next action: {offerNextAction(record.offerLetter.status)}</p>
                  <dl className="text-xs text-gray-400 mt-1 space-y-0.5">
                    {record.offerLetter.sentAt && <p>Sent {formatDateTime(record.offerLetter.sentAt)}</p>}
                    {record.offerLetter.viewedAt && <p>Viewed {formatDateTime(record.offerLetter.viewedAt)}</p>}
                    {record.offerLetter.expiresAt && OFFER_PENDING_STATUSES.includes(record.offerLetter.status) && (
                      <p>Expires {formatDateTime(record.offerLetter.expiresAt)}</p>
                    )}
                    {record.offerLetter.signedAt && <p>Signed {formatDateTime(record.offerLetter.signedAt)} ({record.offerLetter.signatureName})</p>}
                    {record.offerLetter.rejectedAt && (
                      <p>
                        Rejected {formatDateTime(record.offerLetter.rejectedAt)}
                        {record.offerLetter.rejectionReason && ` — ${REJECTION_REASON_LABEL[record.offerLetter.rejectionReason]}`}
                        {record.offerLetter.rejectionComments && `: "${record.offerLetter.rejectionComments}"`}
                      </p>
                    )}
                  </dl>
                </div>
                <div className="flex gap-2 items-center shrink-0 flex-wrap justify-end">
                  {record.offerLetter.documentUrl && (
                    <a
                      href={record.offerLetter.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
                    >
                      Review PDF
                    </a>
                  )}
                  {isHrAdmin && OFFER_DRAFT_STATUSES.includes(record.offerLetter.status) && (
                    <button
                      onClick={sendOfferLetter}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
                    >
                      <MailIcon className="w-4 h-4" />
                      Send Offer Letter
                    </button>
                  )}
                  {isHrAdmin && OFFER_PENDING_STATUSES.includes(record.offerLetter.status) && (
                    <>
                      <button
                        onClick={cancelOfferLetter}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
                      >
                        Cancel Offer
                      </button>
                      <button
                        onClick={extendOfferLetter}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
                      >
                        Extend
                      </button>
                      <button
                        onClick={resendOfferLetter}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
                      >
                        <MailIcon className="w-4 h-4" />
                        Resend
                      </button>
                    </>
                  )}
                  {isHrAdmin && OFFER_DRAFT_STATUSES.includes(record.offerLetter.status) && (
                    <button
                      onClick={cancelOfferLetter}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  )}
                  {isHrAdmin && record.offerLetter.status === 'expired' && (
                    <button
                      onClick={resendOfferLetter}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
                    >
                      <MailIcon className="w-4 h-4" />
                      Resend Offer
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {isHrAdmin && <IdentityDocumentsSection recordId={recordId} employeeName={record.employee.name} />}
          {isHrAdmin && <EducationRecordsSection recordId={recordId} employeeName={record.employee.name} />}
          {isHrAdmin && <ResumeSection employeeId={record.employee.id} employeeName={record.employee.name} />}
          {isHrAdmin && <EmployeeLettersSection recordId={recordId} />}
          {isHrAdmin && <BankDetailsSection recordId={recordId} />}

          {isHrAdmin && record.backgroundVerification && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <FingerprintIcon className="w-4 h-4 text-gray-400" />
                    <h3 className="font-bold text-gray-900">Background Verification</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BGV_STATUS_COLOR[record.backgroundVerification.status]}`}>
                      {BGV_STATUS_LABEL[record.backgroundVerification.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {record.backgroundVerification.documentsSubmitted} of {record.backgroundVerification.documentCount} required documents submitted
                  </p>
                  {record.backgroundVerification.reviewedByName && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Decided by {record.backgroundVerification.reviewedByName}
                      {record.backgroundVerification.reviewedAt ? ` on ${formatDate(record.backgroundVerification.reviewedAt)}` : ''}
                    </p>
                  )}
                  {record.backgroundVerification.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic">&ldquo;{record.backgroundVerification.notes}&rdquo;</p>
                  )}
                </div>
                {record.backgroundVerification.documentCount > 0 && (
                  <a
                    href={onboardingApi.downloadAllDocumentsUrl(record.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 shrink-0"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Download All Documents
                  </a>
                )}
              </div>

              {['pending_documents', 'ready_for_review'].includes(record.backgroundVerification.status) && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-2">
                    Record your decision once you've reviewed the documents — this can't be automated, it's your call.
                  </p>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
                    placeholder="Notes (optional)"
                    rows={2}
                    value={bgvNotes}
                    onChange={(e) => setBgvNotes(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => decideBgv('passed')}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Mark Passed
                    </button>
                    <button
                      onClick={() => decideBgv('failed')}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      Mark Failed
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(['preboarding', 'onboarding'] as TaskCategory[]).map((category) => {
            const tasks = record.tasks.filter((t) => t.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
            if (tasks.length === 0 && category === 'onboarding' && record.stage === 'preboarding') return null;
            return (
              <div key={category} className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">{category === 'preboarding' ? 'Preboarding checklist' : 'Onboarding checklist'}</h3>
                  {isHrAdmin && (
                    <button
                      onClick={() => setShowAddTask(true)}
                      className="flex items-center gap-1 text-purple-600 text-sm font-semibold hover:underline"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      Add task
                    </button>
                  )}
                </div>
                {tasks.length === 0 ? (
                  <p className="text-sm text-gray-500">No tasks yet.</p>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div key={task.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-gray-900 text-sm">{task.title}</p>
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_PILL[task.status]}`}>
                                {TASK_STATUS_LABEL[task.status]}
                              </span>
                              {task.isRequired && <span className="text-[11px] text-gray-400">Required</span>}
                            </div>
                            {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                            <p className="text-xs text-gray-400 mt-1">
                              {OWNER_LABEL[task.owner]} · Due {formatDate(task.dueDate)}
                              {task.requiresDocument ? ' · Needs document' : ''}
                            </p>
                            {isHrAdmin ? (
                              <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                                Assigned to
                                <select
                                  className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs bg-white"
                                  value={task.assignee?.id ?? ''}
                                  disabled={busy}
                                  onChange={(e) => assignTask(task.id, e.target.value ? Number(e.target.value) : null)}
                                >
                                  <option value="">— owner role —</option>
                                  {assigneeOptions.map((emp) => (
                                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                                  ))}
                                  {task.assignee && !assigneeOptions.some((e) => e.id === task.assignee!.id) && (
                                    <option value={task.assignee.id}>{task.assignee.name}</option>
                                  )}
                                </select>
                              </label>
                            ) : (
                              task.assignee && <p className="text-xs text-gray-500 mt-1">Assigned to {task.assignee.name}</p>
                            )}
                          </div>

                          {canActOnTask(task) && task.status !== 'done' && (
                            <div className="flex gap-1.5 shrink-0">
                              {task.status === 'pending' && (
                                <button
                                  onClick={() => setTaskStatus(task.id, 'in_progress')}
                                  disabled={busy}
                                  className="text-xs font-semibold text-blue-600 hover:underline"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                onClick={() => setTaskStatus(task.id, 'done')}
                                disabled={busy}
                                className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-0.5"
                              >
                                <CheckCircleIcon className="w-3.5 h-3.5" />
                                Done
                              </button>
                              {isHrAdmin && (
                                <button
                                  onClick={() => setTaskStatus(task.id, 'skipped')}
                                  disabled={busy}
                                  className="text-xs font-semibold text-gray-500 hover:underline"
                                >
                                  Skip
                                </button>
                              )}
                            </div>
                          )}
                          {isHrAdmin && (
                            <button
                              onClick={() => removeTask(task.id)}
                              disabled={busy}
                              className="text-xs font-semibold text-red-500 hover:underline shrink-0"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        {task.requiresDocument && task.title.trim().toLowerCase() !== IDENTITY_DOCS_TASK_TITLE && (
                          <HrTaskDocuments task={task} employeeId={record.employee.id} canManage={isHrAdmin} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {showAddTask && record && (
        <AddTaskModal
          recordId={record.id}
          defaultJoiningDate={record.joiningDate}
          onClose={() => setShowAddTask(false)}
          onAdded={() => {
            setShowAddTask(false);
            load();
          }}
        />
      )}

      {showEditEmail && record && (
        <EditEmailModal
          recordId={record.id}
          workEmail={record.employee.workEmail}
          personalEmail={record.employee.personalEmail}
          onClose={() => setShowEditEmail(false)}
          onSaved={() => {
            setShowEditEmail(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function EditEmailModal({
  recordId,
  workEmail,
  personalEmail,
  onClose,
  onSaved,
}: {
  recordId: number;
  workEmail: string;
  personalEmail: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ workEmail, personalEmail });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.workEmail.trim()) {
      setError('Work email is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onboardingApi.updateRecord(recordId, {
        workEmail: form.workEmail.trim(),
        personalEmail: form.personalEmail.trim(),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to update email');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Edit candidate email</h2>
        <p className="text-xs text-gray-500 mb-4">
          Corrects the address on file — future offer sends/resends and notifications use the updated address.
          The login account&rsquo;s email is updated to match the work email.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Work email *</span>
            <input
              type="email"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              value={form.workEmail}
              onChange={(e) => setForm((f) => ({ ...f, workEmail: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Personal email</span>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              value={form.personalEmail}
              onChange={(e) => setForm((f) => ({ ...f, personalEmail: e.target.value }))}
            />
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddTaskModal({
  recordId,
  onClose,
  onAdded,
}: {
  recordId: number;
  defaultJoiningDate: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('preboarding');
  const [owner, setOwner] = useState<TaskOwner>('new_hire');
  const [dueDate, setDueDate] = useState('');
  const [isRequired, setIsRequired] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onboardingApi.addTask(recordId, {
        category,
        title,
        description,
        owner,
        isRequired,
        dueDate: dueDate || null,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to add task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Add task</h2>
        <form onSubmit={submit} className="space-y-3">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
              <option value="preboarding">Preboarding</option>
              <option value="onboarding">Onboarding</option>
            </select>
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={owner} onChange={(e) => setOwner(e.target.value as TaskOwner)}>
              <option value="new_hire">New hire</option>
              <option value="hr_admin">HR Admin</option>
              <option value="manager">Manager</option>
              <option value="buddy">Buddy</option>
              <option value="it_admin">IT Admin</option>
            </select>
          </div>
          <input
            type="date"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            Required
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50">
              {submitting ? 'Adding...' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HrTaskDocuments({ task, employeeId, canManage }: { task: OnboardingTask; employeeId: number; canManage: boolean }) {
  const [docs, setDocs] = useState<UploadedDocument[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
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
    setUploading(true);
    setUploadError('');
    try {
      await documentsApi.upload(file, 'onboarding_task', task.id, employeeId);
      await load();
    } catch (e) {
      setUploadError(e instanceof DocumentsApiError ? e.message : 'Failed to upload document');
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

  if (docs === null) return null;
  if (docs.length === 0 && !canManage) return null;

  return (
    <div className="mt-2.5 pl-0.5">
      {docs.length > 0 && (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
              <FileTextIcon className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              {doc.url ? (
                // Opens inline in a new tab (browser's native PDF/image viewer) — not a download.
                <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-gray-700 hover:text-purple-600 hover:underline truncate flex-1">
                  {doc.originalFilename}
                </a>
              ) : (
                <span className="text-xs text-gray-700 truncate flex-1">{doc.originalFilename}</span>
              )}
              <span className="text-[10px] text-gray-400 shrink-0">{formatDate(doc.uploadedAt)}</span>
              {canManage && (
                <button onClick={() => setRemoveTarget(doc)} className="text-gray-400 hover:text-red-600 shrink-0" title="Remove">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {uploadError ? <p className="text-xs text-red-600 mt-1">{uploadError}</p> : null}
      {canManage && (
        <label className="inline-block text-xs font-semibold text-purple-600 hover:underline cursor-pointer mt-1.5">
          {uploading ? 'Uploading…' : '+ Attach file'}
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

function identityDisplayStatus(doc: IdentityDocument): DocumentDisplayStatus {
  if (doc.verificationStatus === 'rejected') return 'rejected';
  if (doc.isExpired) return 'expired';
  if (doc.verificationStatus === 'verified') return 'verified';
  return 'pending_verification';
}

function IdentityDocumentsSection({ recordId, employeeName }: { recordId: number; employeeName: string }) {
  const [docs, setDocs] = useState<IdentityDocument[] | undefined>(undefined);
  // Full numbers are fetched once, on the first eye click (that fetch is the
  // audited reveal); after that each card's eye only toggles display.
  const [fullNumbers, setFullNumbers] = useState<Record<number, string> | null>(null);
  const [shownIds, setShownIds] = useState<Set<number>>(new Set());
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [viewerDoc, setViewerDoc] = useState<ViewableDocument | null>(null);
  const [detailsData, setDetailsData] = useState<DocumentDetailsData | null>(null);
  const [rejectTarget, setRejectTarget] = useState<IdentityDocument | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const load = async () => {
    try {
      setDocs(await onboardingApi.getIdentityDocuments(recordId, false));
    } catch {
      setDocs([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const toggleNumber = async (id: number) => {
    if (shownIds.has(id)) {
      setShownIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      return;
    }
    if (!fullNumbers?.[id]) {
      setRevealingId(id);
      try {
        const revealed = await onboardingApi.getIdentityDocuments(recordId, true);
        setFullNumbers(Object.fromEntries(revealed.filter((d) => d.documentNumber).map((d) => [d.id, d.documentNumber!])));
      } catch (e) {
        alert(e instanceof OnboardingApiError ? e.message : 'Failed to reveal number');
        return;
      } finally {
        setRevealingId(null);
      }
    }
    setShownIds((s) => new Set(s).add(id));
  };

  const verify = async (id: number) => {
    setBusyId(id);
    try {
      await onboardingApi.verifyIdentityDocument(id, 'verified');
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to record decision');
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async (reason?: string) => {
    if (!rejectTarget) return;
    setRejectLoading(true);
    setRejectError('');
    try {
      await onboardingApi.verifyIdentityDocument(rejectTarget.id, 'rejected', reason);
      setRejectTarget(null);
      await load();
    } catch (e) {
      setRejectError(e instanceof OnboardingApiError ? e.message : 'Failed to reject document');
    } finally {
      setRejectLoading(false);
    }
  };

  if (docs === undefined) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-gray-900">Identity Documents</h3>
      </div>
      <p className="text-xs text-gray-400 mb-3">HR Admin &amp; Finance can view; only HR Admin can verify. Showing a full number (eye icon) is audited.</p>

      {docs.length === 0 ? (
        <p className="text-sm text-gray-500">Not submitted yet.</p>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const viewable: ViewableDocument | null = doc.fileUrl
              ? { originalFilename: doc.fileName || IDENTITY_DOCUMENT_TYPE_LABEL[doc.documentType], viewUrl: doc.fileUrl, downloadUrl: doc.fileDownloadUrl }
              : null;
            const menuItems: DocumentActionMenuItem[] = [
              {
                key: 'details',
                label: 'View details',
                onClick: () =>
                  setDetailsData({
                    name: IDENTITY_DOCUMENT_TYPE_LABEL[doc.documentType],
                    category: 'Identity',
                    status: identityDisplayStatus(doc),
                    uploadedAt: doc.createdAt,
                    updatedAt: doc.updatedAt,
                    uploadedByName: doc.submittedByName,
                    verifiedByName: doc.verifiedByName,
                    verifiedAt: doc.verifiedAt,
                    expiryDate: doc.expiryDate,
                    isExpired: doc.isExpired,
                    fileName: doc.fileName,
                    fileSize: doc.fileSize,
                    rejectionReason: doc.verificationStatus === 'rejected' ? doc.verificationNotes : null,
                  }),
              },
            ];
            if (doc.fileDownloadUrl) {
              menuItems.push({ key: 'download', label: 'Download', onClick: () => window.open(doc.fileDownloadUrl!, '_blank') });
            }
            if (doc.verificationStatus === 'pending') {
              menuItems.push({ key: 'reject', label: 'Reject', tone: 'danger', onClick: () => setRejectTarget(doc) });
            }

            return (
              <div key={doc.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900 text-sm">{IDENTITY_DOCUMENT_TYPE_LABEL[doc.documentType]}</p>
                      <DocumentStatusBadge status={identityDisplayStatus(doc)} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                      <p className="flex items-center gap-1.5">
                        Number:{' '}
                        <span className="font-mono">
                          {shownIds.has(doc.id) && fullNumbers?.[doc.id] ? fullNumbers[doc.id] : doc.documentNumberMasked}
                        </span>
                        <button
                          onClick={() => toggleNumber(doc.id)}
                          disabled={revealingId === doc.id}
                          className="text-gray-400 hover:text-purple-600 disabled:opacity-50"
                          title={shownIds.has(doc.id) ? 'Hide number' : 'Show full number'}
                          aria-label={shownIds.has(doc.id) ? 'Hide number' : 'Show full number'}
                        >
                          {shownIds.has(doc.id) ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                        </button>
                      </p>
                      {doc.fullName && <p>Name: {doc.fullName}</p>}
                      {doc.dateOfBirth && <p>DOB: {formatDate(doc.dateOfBirth)}</p>}
                      {doc.gender && <p>Gender: {doc.gender}</p>}
                      {doc.parentOrGuardianName && <p>Parent/Guardian: {doc.parentOrGuardianName}</p>}
                      {doc.address && <p className="col-span-2">Address: {doc.address}</p>}
                    </dl>
                    {doc.expiryDate ? (
                      <div className="mt-1.5">
                        <ExpiryIndicator expiryDate={doc.expiryDate} isExpired={doc.isExpired} />
                      </div>
                    ) : null}
                    {viewable && (
                      <button
                        onClick={() => setViewerDoc(viewable)}
                        className="inline-flex items-center gap-1 text-purple-600 text-xs font-semibold hover:underline mt-1.5"
                      >
                        <FileTextIcon className="w-3.5 h-3.5" />
                        View scanned copy
                      </button>
                    )}
                    {doc.verificationStatus !== 'pending' && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        {doc.verificationStatusDisplay} by {doc.verifiedByName}{doc.verifiedAt ? ` on ${formatDate(doc.verifiedAt)}` : ''}
                        {doc.verificationNotes ? ` — "${doc.verificationNotes}"` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {doc.verificationStatus === 'pending' && (
                      <button
                        onClick={() => verify(doc.id)}
                        disabled={busyId === doc.id}
                        className="text-xs font-semibold text-emerald-600 hover:underline px-2 py-1.5"
                      >
                        Verify
                      </button>
                    )}
                    <DocumentActionMenu items={menuItems} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewerDoc ? <DocumentViewerModal document={viewerDoc} onClose={() => setViewerDoc(null)} /> : null}
      {detailsData ? <DocumentDetailsDrawer data={detailsData} onClose={() => setDetailsData(null)} /> : null}
      {rejectTarget ? (
        <ConfirmDialog
          title="Reject Document"
          description={`${IDENTITY_DOCUMENT_TYPE_LABEL[rejectTarget.documentType]} — ${employeeName}. Please provide a reason for rejecting this document; the candidate will see it and can resubmit.`}
          tone="danger"
          confirmLabel="Reject Document"
          loading={rejectLoading}
          error={rejectError}
          reason={{ label: 'Reason', placeholder: 'e.g. Document is unclear. Please upload a higher-resolution copy.' }}
          onCancel={() => {
            if (rejectLoading) return;
            setRejectTarget(null);
            setRejectError('');
          }}
          onConfirm={confirmReject}
        />
      ) : null}
    </div>
  );
}

function educationDisplayStatus(record: EducationRecord): DocumentDisplayStatus {
  if (record.verificationStatus === 'rejected') return 'rejected';
  if (record.verificationStatus === 'verified') return 'verified';
  return 'pending_verification';
}

function EducationRecordsSection({ recordId, employeeName }: { recordId: number; employeeName: string }) {
  const [records, setRecords] = useState<EducationRecord[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [viewerDoc, setViewerDoc] = useState<ViewableDocument | null>(null);
  const [detailsData, setDetailsData] = useState<DocumentDetailsData | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EducationRecord | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const load = async () => {
    try {
      setRecords(await onboardingApi.getEducationRecords(recordId));
    } catch {
      setRecords([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const verify = async (id: number) => {
    setBusyId(id);
    try {
      await onboardingApi.verifyEducationRecord(id, 'verified');
      await load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to record decision');
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async (reason?: string) => {
    if (!rejectTarget) return;
    setRejectLoading(true);
    setRejectError('');
    try {
      await onboardingApi.verifyEducationRecord(rejectTarget.id, 'rejected', reason);
      setRejectTarget(null);
      await load();
    } catch (e) {
      setRejectError(e instanceof OnboardingApiError ? e.message : 'Failed to reject record');
    } finally {
      setRejectLoading(false);
    }
  };

  if (records === undefined) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <h3 className="font-bold text-gray-900 mb-1">Degrees & Certificates</h3>
      <p className="text-xs text-gray-400 mb-3">Visible to HR Admin, Finance, and this employee&apos;s manager.</p>

      {records.length === 0 ? (
        <p className="text-sm text-gray-500">Not submitted yet.</p>
      ) : (
        <div className="space-y-3">
          {records.map((record) => {
            const viewable: ViewableDocument | null = record.fileUrl
              ? { originalFilename: record.fileName || record.degree, viewUrl: record.fileUrl, downloadUrl: record.fileDownloadUrl }
              : null;
            const menuItems: DocumentActionMenuItem[] = [
              {
                key: 'details',
                label: 'View details',
                onClick: () =>
                  setDetailsData({
                    name: record.degree,
                    category: 'Degrees & Certificates',
                    status: educationDisplayStatus(record),
                    uploadedAt: record.createdAt,
                    updatedAt: record.updatedAt,
                    uploadedByName: record.submittedByName,
                    verifiedByName: record.verifiedByName,
                    verifiedAt: record.verifiedAt,
                    expiryDate: null,
                    isExpired: false,
                    fileName: record.fileName,
                    fileSize: record.fileSize,
                    rejectionReason: record.verificationStatus === 'rejected' ? record.verificationNotes : null,
                  }),
              },
            ];
            if (record.fileDownloadUrl) {
              menuItems.push({ key: 'download', label: 'Download', onClick: () => window.open(record.fileDownloadUrl!, '_blank') });
            }
            if (record.verificationStatus === 'pending') {
              menuItems.push({ key: 'reject', label: 'Reject', tone: 'danger', onClick: () => setRejectTarget(record) });
            }

            return (
              <div key={record.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900 text-sm">{record.degree}</p>
                      <DocumentStatusBadge status={educationDisplayStatus(record)} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                      {record.branch && <p>Branch: {record.branch}</p>}
                      {record.university && <p>University: {record.university}</p>}
                      {record.yearOfJoining && <p>Joined: {record.yearOfJoining}</p>}
                      {record.yearOfCompletion && <p>Completed: {record.yearOfCompletion}</p>}
                      {record.grade && <p>Grade: {record.grade}</p>}
                    </dl>
                    {viewable && (
                      <button
                        onClick={() => setViewerDoc(viewable)}
                        className="inline-flex items-center gap-1 text-purple-600 text-xs font-semibold hover:underline mt-1.5"
                      >
                        <FileTextIcon className="w-3.5 h-3.5" />
                        View scanned copy
                      </button>
                    )}
                    {record.verificationStatus !== 'pending' && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        {record.verificationStatusDisplay} by {record.verifiedByName}{record.verifiedAt ? ` on ${formatDate(record.verifiedAt)}` : ''}
                        {record.verificationNotes ? ` — "${record.verificationNotes}"` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {record.verificationStatus === 'pending' && (
                      <button
                        onClick={() => verify(record.id)}
                        disabled={busyId === record.id}
                        className="text-xs font-semibold text-emerald-600 hover:underline px-2 py-1.5"
                      >
                        Verify
                      </button>
                    )}
                    <DocumentActionMenu items={menuItems} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewerDoc ? <DocumentViewerModal document={viewerDoc} onClose={() => setViewerDoc(null)} /> : null}
      {detailsData ? <DocumentDetailsDrawer data={detailsData} onClose={() => setDetailsData(null)} /> : null}
      {rejectTarget ? (
        <ConfirmDialog
          title="Reject Document"
          description={`${rejectTarget.degree} — ${employeeName}. Please provide a reason for rejecting this record; the candidate will see it and can resubmit.`}
          tone="danger"
          confirmLabel="Reject Document"
          loading={rejectLoading}
          error={rejectError}
          reason={{ label: 'Reason', placeholder: 'e.g. Certificate is unclear. Please upload a higher-resolution copy.' }}
          onCancel={() => {
            if (rejectLoading) return;
            setRejectTarget(null);
            setRejectError('');
          }}
          onConfirm={confirmReject}
        />
      ) : null}
    </div>
  );
}

function ResumeSection({ employeeId, employeeName }: { employeeId: number; employeeName: string }) {
  const [docs, setDocs] = useState<UploadedDocument[] | null>(null);
  const [viewerDoc, setViewerDoc] = useState<ViewableDocument | null>(null);
  const [detailsData, setDetailsData] = useState<DocumentDetailsData | null>(null);

  useEffect(() => {
    documentsApi
      .list('resume', employeeId)
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [employeeId]);

  if (docs === null) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <h3 className="font-bold text-gray-900 mb-1">Resume</h3>
      <p className="text-xs text-gray-400 mb-3">Visible to HR Admin and this employee&apos;s manager.</p>

      {docs.length === 0 ? (
        <p className="text-sm text-gray-500">Not submitted yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <FileTextIcon className="w-4 h-4 text-purple-500 shrink-0" />
                <button
                  onClick={() => setViewerDoc({ originalFilename: doc.originalFilename, viewUrl: doc.viewUrl ?? doc.url, downloadUrl: doc.downloadUrl ?? doc.url })}
                  className="text-sm font-medium text-gray-800 hover:text-purple-600 truncate text-left"
                >
                  {doc.originalFilename}
                </button>
              </div>
              <DocumentActionMenu
                items={[
                  {
                    key: 'details',
                    label: 'View details',
                    onClick: () =>
                      setDetailsData({
                        name: doc.originalFilename,
                        category: `Resume — ${employeeName}`,
                        status: doc.isExpired ? 'expired' : null,
                        uploadedAt: doc.uploadedAt,
                        uploadedByName: doc.uploadedByName,
                        expiryDate: doc.expiryDate,
                        isExpired: doc.isExpired,
                        fileName: doc.originalFilename,
                        fileSize: doc.fileSize,
                      }),
                  },
                  { key: 'download', label: 'Download', onClick: () => window.open(doc.downloadUrl ?? doc.url ?? '', '_blank') },
                ]}
              />
            </div>
          ))}
        </div>
      )}
      {viewerDoc ? <DocumentViewerModal document={viewerDoc} onClose={() => setViewerDoc(null)} /> : null}
      {detailsData ? <DocumentDetailsDrawer data={detailsData} onClose={() => setDetailsData(null)} /> : null}
    </div>
  );
}

const EMPLOYEE_LETTER_TYPES: EmployeeLetterType[] = ['appointment', 'appraisal', 'promotion', 'other'];

function EmployeeLettersSection({ recordId }: { recordId: number }) {
  const [letters, setLetters] = useState<EmployeeLetterRecord[] | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ViewableDocument | null>(null);
  const [detailsData, setDetailsData] = useState<DocumentDetailsData | null>(null);

  const load = async () => {
    try {
      setLetters(await onboardingApi.getEmployeeLetters(recordId));
    } catch {
      setLetters([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  if (letters === undefined) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-gray-900">Employee Letters</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-purple-600 text-xs font-semibold hover:underline">
            <PlusIcon className="w-3.5 h-3.5" />
            Issue letter
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">Appointment, appraisal, and promotion letters — always issued by HR.</p>

      {letters.length === 0 && !adding ? (
        <p className="text-sm text-gray-500">None issued yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {letters.map((letter) => {
            const viewable: ViewableDocument | null = letter.fileUrl
              ? { originalFilename: letter.fileName || letter.title, viewUrl: letter.fileUrl, downloadUrl: letter.fileDownloadUrl }
              : null;
            return (
              <div key={letter.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{letter.title}</p>
                  <p className="text-xs text-gray-500">
                    {letter.letterTypeDisplay}
                    {letter.issuedDate ? ` · ${formatDate(letter.issuedDate)}` : ''}
                  </p>
                </div>
                {viewable && (
                  <button onClick={() => setViewerDoc(viewable)} className="text-purple-600 text-xs font-semibold hover:underline shrink-0">
                    View
                  </button>
                )}
                <DocumentActionMenu
                  items={[
                    {
                      key: 'details',
                      label: 'View details',
                      onClick: () =>
                        setDetailsData({
                          name: letter.title,
                          category: letter.letterTypeDisplay,
                          status: null,
                          uploadedAt: letter.createdAt,
                          uploadedByName: letter.uploadedByName,
                          expiryDate: null,
                          isExpired: false,
                          fileName: letter.fileName,
                          fileSize: null,
                        }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <EmployeeLetterForm
          recordId={recordId}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
      {viewerDoc ? <DocumentViewerModal document={viewerDoc} onClose={() => setViewerDoc(null)} /> : null}
      {detailsData ? <DocumentDetailsDrawer data={detailsData} onClose={() => setDetailsData(null)} /> : null}
    </div>
  );
}

function EmployeeLetterForm({ recordId, onCancel, onSaved }: { recordId: number; onCancel: () => void; onSaved: () => void }) {
  const [letterType, setLetterType] = useState<EmployeeLetterType>('appointment');
  const [title, setTitle] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setSubmitting(true);
    try {
      await onboardingApi.addEmployeeLetter(recordId, { letterType, title: title || undefined, issuedDate: issuedDate || null }, file);
      onSaved();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to issue letter');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Letter type</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            value={letterType}
            onChange={(e) => setLetterType(e.target.value as EmployeeLetterType)}
          >
            {EMPLOYEE_LETTER_TYPES.map((t) => (
              <option key={t} value={t}>{EMPLOYEE_LETTER_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Title (optional)</label>
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={EMPLOYEE_LETTER_TYPE_LABEL[letterType]} />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Issued date (optional)</label>
        <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">File</label>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50">
          {submitting ? 'Uploading…' : 'Issue Letter'}
        </button>
      </div>
    </form>
  );
}

function BankDetailsSection({ recordId }: { recordId: number }) {
  const [bank, setBank] = useState<BankDetails | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const load = async (reveal: boolean) => {
    try {
      setBank(await onboardingApi.getBankDetails(recordId, reveal));
    } catch {
      setBank(null);
    }
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const [shown, setShown] = useState(false);

  // First click fetches the full number (the audited reveal); after that the
  // eye only toggles display.
  const toggleShown = async () => {
    if (shown) {
      setShown(false);
      return;
    }
    if (!revealed) {
      setRevealing(true);
      try {
        await load(true);
        setRevealed(true);
      } finally {
        setRevealing(false);
      }
    }
    setShown(true);
  };

  if (bank === undefined) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-gray-900">Bank Account Details</h3>
      </div>
      <p className="text-xs text-gray-400 mb-3">HR Admin &amp; Finance only. Showing the full number (eye icon) is audited.</p>

      {bank ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-gray-400">Account holder</dt>
            <dd className="text-gray-900 font-semibold">{bank.accountHolderName}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Account number</dt>
            <dd className="flex items-center gap-1.5 text-gray-900 font-semibold font-mono">
              {shown && bank.accountNumber ? bank.accountNumber : bank.accountNumberMasked}
              <button
                onClick={toggleShown}
                disabled={revealing}
                className="text-gray-400 hover:text-purple-600 disabled:opacity-50"
                title={shown ? 'Hide number' : 'Show full number'}
                aria-label={shown ? 'Hide number' : 'Show full number'}
              >
                {shown ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            </dd>
          </div>
          {bank.ifscCode && (
            <div>
              <dt className="text-xs text-gray-400">IFSC code</dt>
              <dd className="text-gray-900">{bank.ifscCode}</dd>
            </div>
          )}
          {bank.bankName && (
            <div>
              <dt className="text-xs text-gray-400">Bank</dt>
              <dd className="text-gray-900">{bank.bankName}{bank.branchName ? ` · ${bank.branchName}` : ''}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-gray-500">Not submitted yet.</p>
      )}
    </div>
  );
}
