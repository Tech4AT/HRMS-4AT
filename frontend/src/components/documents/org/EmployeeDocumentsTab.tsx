'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { documentsApi, DocumentsApiError, VerifiableDocument } from '@/lib/api/documents';
import { EmptyRow, SectionHeader, SELECT, TH } from './shared';

const SUBS = [
  { key: 'pending-verification', label: 'Pending Verification' },
  { key: 'pending-employee', label: 'Pending on Employee' },
  { key: 'verified', label: 'Verified Documents' },
  { key: 'expiring', label: 'Expiring Docs' },
  { key: 'bulk', label: 'Bulk Uploads' },
  { key: 'settings', label: 'Settings' },
] as const;
type SubKey = (typeof SUBS)[number]['key'];

/** Minimal employee directory row — the org page already loads the full
 * directory, so this tab joins on employeeId instead of the backend
 * denormalising org fields onto every document. */
export interface EmployeeLite {
  id: string;
  name: string;
  title: string;
  department: string;
  location: string;
}

const BASE = ['Group', 'Employee', 'Job title', 'Document title', 'Department', 'Location'];
const FILTERS = ['Business Unit', 'Department', 'Location', 'Cost Center', 'Legal Entity', 'Document Type'];

function docTitle(d: VerifiableDocument): string {
  return d.originalFilename || 'Untitled document';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? '—' : new Date(iso).toLocaleDateString();
}

function empOf(employees: EmployeeLite[], d: VerifiableDocument) {
  return employees.find((e) => String(e.id) === String(d.employeeId)) ?? null;
}

function groupOf(employees: EmployeeLite[], d: VerifiableDocument): string {
  return empOf(employees, d)?.department || '—';
}

export function EmployeeDocumentsTab({
  verified,
  employees = [],
}: {
  verified: ReactNode;
  employees?: EmployeeLite[];
}) {
  const [sub, setSub] = useState<SubKey>('verified');
  const [by, setBy] = useState<'employee' | 'document'>('employee');

  const [pending, setPending] = useState<VerifiableDocument[] | null>(null);
  const [expiring, setExpiring] = useState<VerifiableDocument[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | number | null>(null);
  const [reason, setReason] = useState('');
  const [bulkReason, setBulkReason] = useState('');

  const loadPending = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPending(await documentsApi.pendingVerification());
    } catch (e) {
      setPending(null);
      setLoadError(e instanceof DocumentsApiError ? e.message : 'Failed to load pending verifications');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExpiring = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setExpiring(await documentsApi.expiring(30));
    } catch (e) {
      setExpiring(null);
      setLoadError(e instanceof DocumentsApiError ? e.message : 'Failed to load expiring documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sub === 'pending-verification') void loadPending();
    else if (sub === 'expiring') void loadExpiring();
  }, [sub, loadPending, loadExpiring]);

  const mutate = async (fn: () => Promise<unknown>, reload: () => Promise<void>) => {
    setActionError(null);
    setActing(true);
    try {
      await fn();
      setRejectingId(null);
      setReason('');
      await reload();
    } catch (e) {
      setActionError(e instanceof DocumentsApiError ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const verify = (d: VerifiableDocument) =>
    mutate(() => documentsApi.verify(d.id), loadPending);
  const confirmReject = (d: VerifiableDocument) =>
    mutate(() => documentsApi.reject(d.id, reason), loadPending);
  const verifyAll = (docs: VerifiableDocument[]) =>
    mutate(async () => {
      for (const d of docs) await documentsApi.verify(d.id);
    }, loadPending);
  const rejectAll = (docs: VerifiableDocument[]) =>
    mutate(async () => {
      for (const d of docs) await documentsApi.reject(d.id, bulkReason);
    }, loadPending);
  const nudge = (d: VerifiableDocument) =>
    mutate(() => documentsApi.nudge(d.id), loadExpiring);

  const renderPendingTable = (docs: VerifiableDocument[]) => {
    if (by === 'employee') {
      const groups = new Map<string, VerifiableDocument[]>();
      for (const d of docs) {
        const key = empOf(employees, d)?.name ?? 'Unknown employee';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(d);
      }
      return (
        <div className="space-y-4">
          {[...groups.entries()].map(([name, rows]) => (
            <div key={name} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-slate-800">
                {name} <span className="font-normal text-gray-500">({rows.length})</span>
              </div>
              {pendingRows(rows, false)}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
        {pendingRows(docs, true)}
      </div>
    );
  };

  const pendingRows = (docs: VerifiableDocument[], showEmployee: boolean) => (
    <table className="w-full">
      <thead className="bg-gray-50 border-b border-gray-200">
        <tr>
          {[...BASE, 'Date of submission', 'Actions'].map((c) => (
            <th key={c} className={TH}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => {
          const emp = empOf(employees, d);
          return (
            <tr key={d.id} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-3 text-sm text-slate-600">{groupOf(employees, d)}</td>
              <td className="px-4 py-3 text-sm font-medium text-slate-800">{showEmployee ? emp?.name ?? '—' : emp?.name ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{emp?.title ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-800">{docTitle(d)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{emp?.department ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{emp?.location ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(d.uploadedAt)}</td>
              <td className="px-4 py-3 text-sm">
                {rejectingId === d.id ? (
                  <span className="flex items-center gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Rejection reason (required)"
                      className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 w-48 focus:outline-none focus:border-purple-400"
                      aria-label="Rejection reason"
                    />
                    <button
                      type="button"
                      disabled={acting || !reason.trim()}
                      onClick={() => void confirmReject(d)}
                      className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded-md disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setReason('');
                      }}
                      className="px-2 py-1 text-xs text-gray-600"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void verify(d)}
                      className="px-2 py-1 text-xs font-medium text-white bg-purple-600 rounded-md disabled:opacity-50"
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => setRejectingId(d.id)}
                      className="px-2 py-1 text-xs font-medium text-red-700 border border-red-200 rounded-md disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderExpiringTable = (docs: VerifiableDocument[]) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {[...BASE, 'Expiration date', 'Actions'].map((c) => (
              <th key={c} className={TH}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const emp = empOf(employees, d);
            return (
              <tr key={d.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-sm text-slate-600">{groupOf(employees, d)}</td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800">{emp?.name ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{emp?.title ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-800">{docTitle(d)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{emp?.department ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{emp?.location ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(d.expiryDate)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    {d.viewUrl && (
                      <a href={d.viewUrl} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs font-medium text-purple-700 border border-purple-200 rounded-md">
                        View
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void nudge(d)}
                      className="px-2 py-1 text-xs font-medium text-white bg-purple-600 rounded-md disabled:opacity-50"
                    >
                      Nudge
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const listBlock = (
    title: string,
    subtitle: string | undefined,
    docs: VerifiableDocument[] | null,
    empty: string,
    table: (d: VerifiableDocument[]) => ReactNode,
    bulk?: ReactNode,
  ) => (
    <>
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="flex items-center gap-3 flex-wrap">
        {FILTERS.map((f) => (
          <select key={f} disabled className={SELECT} aria-label={f}><option>{f}</option></select>
        ))}
        <input disabled placeholder="Search" className={`${SELECT} ml-auto w-56`} aria-label="Search" />
      </div>
      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{actionError}</p>
      )}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <EmptyRow>Loading…</EmptyRow>
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <EmptyRow>{loadError}</EmptyRow>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">Total: {docs?.length ?? 0}</p>
          {!docs?.length ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <EmptyRow>{empty}</EmptyRow>
            </div>
          ) : (
            table(docs)
          )}
          {bulk}
        </>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap" role="tablist">
          {SUBS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={sub === s.key}
              onClick={() => setSub(s.key)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium ${
                sub === s.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['employee', 'document'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setBy(k)}
              className={`px-3 py-1.5 font-medium ${by === k ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'}`}
            >
              {k === 'employee' ? 'By Employee' : 'By Document'}
            </button>
          ))}
        </div>
      </div>

      {sub === 'verified' ? (
        verified
      ) : sub === 'pending-verification' ? (
        listBlock(
          'Pending Verification',
          undefined,
          pending,
          'Nothing pending verification',
          renderPendingTable,
          pending && pending.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={acting}
                onClick={() => void verifyAll(pending)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md disabled:opacity-50"
              >
                Verify All
              </button>
              <input
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="Reason for rejecting all"
                className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-purple-400"
                aria-label="Reason for rejecting all"
              />
              <button
                type="button"
                disabled={acting || !bulkReason.trim()}
                onClick={() => void rejectAll(pending)}
                className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-md disabled:opacity-50"
              >
                Reject All
              </button>
            </div>
          ) : undefined,
        )
      ) : sub === 'pending-employee' ? (
        <>
          <SectionHeader title="Pending on Employee" subtitle="Mandatory documents which are pending on employee" />
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <EmptyRow>
              Mandatory document types aren&apos;t configured yet — once HR defines which documents every
              employee must submit, the missing ones will appear here with Nudge actions.
            </EmptyRow>
          </div>
        </>
      ) : sub === 'expiring' ? (
        listBlock(
          'Expiring Docs',
          'Documents expiring in the next 30 days',
          expiring,
          'No documents expiring',
          renderExpiringTable,
        )
      ) : (
        <>
          <SectionHeader
            title={sub === 'bulk' ? 'Bulk uploads' : 'Document settings'}
            subtitle={
              sub === 'bulk'
                ? 'Upload documents for many employees at once.'
                : 'Configure the document types employees are asked to submit.'
            }
          />
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <EmptyRow>{sub === 'bulk' ? 'No bulk uploads' : 'No document types configured'}</EmptyRow>
          </div>
        </>
      )}
    </div>
  );
}
