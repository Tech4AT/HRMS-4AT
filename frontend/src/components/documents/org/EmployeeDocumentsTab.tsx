'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { documentsApi, DocumentsApiError, VerifiableDocument } from '@/lib/api/documents';
import { EmptyRow, SectionHeader, SELECT, TH, BTN_OUTLINE } from './shared';
import { DocumentUploadModal } from '../DocumentUploadModal';

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
 * denormalising org fields onto every document. subDepartment / costCenter /
 * legalEntity may be blank when the directory doesn't carry them; the Keka
 * columns are still shown (empty cell) so the layout matches for verification. */
export interface EmployeeLite {
  id: string;
  name: string;
  title: string;
  department: string;
  location: string;
  subDepartment?: string;
}

// Exact Keka column sets per sub-tab (rendered uppercase via TH styling).
const BASE = ['Group', 'Employee', 'Job title', 'Document title', 'Department', 'Sub department', 'Location'];
const COLS: Record<'pending-verification' | 'pending-employee' | 'verified' | 'expiring', string[]> = {
  'pending-verification': [...BASE, 'Date of submission', 'Actions'],
  'pending-employee': [...BASE, 'Actions'],
  verified: [...BASE, 'Date created', 'Expiration date', 'Actions'],
  expiring: [...BASE, 'Expiration date', 'Actions'],
};
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

export function EmployeeDocumentsTab({
  employees = [],
}: {
  /** Kept for API compatibility with the org page; verified rows are rendered
   * in-tab now so the Keka columns match. */
  verified?: ReactNode;
  employees?: EmployeeLite[];
}) {
  const [sub, setSub] = useState<SubKey>('pending-verification');
  const [by, setBy] = useState<'employee' | 'document'>('employee');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEmp, setUploadEmp] = useState('');

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

  const verify = (d: VerifiableDocument) => mutate(() => documentsApi.verify(d.id), loadPending);
  const confirmReject = (d: VerifiableDocument) => mutate(() => documentsApi.reject(d.id, reason), loadPending);
  const verifyAll = (docs: VerifiableDocument[]) =>
    mutate(async () => {
      for (const d of docs) await documentsApi.verify(d.id);
    }, loadPending);
  const rejectAll = (docs: VerifiableDocument[]) =>
    mutate(async () => {
      for (const d of docs) await documentsApi.reject(d.id, bulkReason);
    }, loadPending);
  const nudge = (d: VerifiableDocument) => mutate(() => documentsApi.nudge(d.id), loadExpiring);

  /** No employee details are shown by default: rows appear only once a name is
   * searched (or a doc has no matching directory row and the query is blank we
   * still keep it hidden). Keeps the migration-verification view clean. */
  const filterByName = useCallback(
    (docs: VerifiableDocument[] | null): VerifiableDocument[] => {
      if (!docs || !query.trim()) return [];
      const q = query.trim().toLowerCase();
      return docs.filter((d) => (empOf(employees, d)?.name ?? '').toLowerCase().includes(q));
    },
    [employees, query],
  );

  const cell = (v: string | undefined | null) => (
    <td className="px-4 py-3 text-sm text-slate-600">{v || '—'}</td>
  );

  /** One table body row across the shared base columns; callers append their
   * date + action cells. */
  const baseCells = (d: VerifiableDocument) => {
    const emp = empOf(employees, d);
    return (
      <>
        {cell(emp?.department)}
        <td className="px-4 py-3 text-sm font-medium text-slate-800">{emp?.name ?? '—'}</td>
        {cell(emp?.title)}
        <td className="px-4 py-3 text-sm text-slate-800">{docTitle(d)}</td>
        {cell(emp?.department)}
        {cell(emp?.subDepartment)}
        {cell(emp?.location)}
      </>
    );
  };

  /** Shared table shell — the header (all Keka columns) is ALWAYS rendered;
   * an empty body shows a single hint row so the column names stay verifiable
   * even with no records. */
  const Table = ({ columns, rows }: { columns: string[]; rows: ReactNode[] }) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {columns.map((c) => (
              <th key={c} className={TH}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-5 py-10 text-center text-sm text-gray-500">
                {query.trim() ? 'No matching records' : 'Search an employee by name to view records'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const actionsCol = (d: VerifiableDocument) =>
    rejectingId === d.id ? (
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
    );

  const pendingRows = filterByName(pending).map((d) => (
    <tr key={d.id} className="border-b border-gray-100 last:border-0">
      {baseCells(d)}
      {cell(fmtDate(d.uploadedAt))}
      <td className="px-4 py-3 text-sm">{actionsCol(d)}</td>
    </tr>
  ));

  const verifiedShown = useMemo(() => filterByName(pending), [filterByName, pending]);
  const verifiedRows = verifiedShown
    .filter((d) => d.verificationStatus === 'verified')
    .map((d) => (
      <tr key={d.id} className="border-b border-gray-100 last:border-0">
        {baseCells(d)}
        {cell(fmtDate(d.uploadedAt))}
        {cell(fmtDate(d.expiryDate))}
        <td className="px-4 py-3 text-sm">
          {d.viewUrl && (
            <a href={d.viewUrl} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs font-medium text-purple-700 border border-purple-200 rounded-md">
              View
            </a>
          )}
        </td>
      </tr>
    ));

  const expiringRows = filterByName(expiring).map((d) => (
    <tr key={d.id} className="border-b border-gray-100 last:border-0">
      {baseCells(d)}
      {cell(fmtDate(d.expiryDate))}
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
  ));

  // Filter/search bar shown above every records table.
  const filterBar = (extraFilter?: string) => (
    <div className="flex items-center gap-3 flex-wrap">
      {[...FILTERS, ...(extraFilter ? [extraFilter] : [])].map((f) => (
        <select key={f} disabled className={SELECT} aria-label={f}>
          <option>{f}</option>
        </select>
      ))}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search employee by name"
        className={`${SELECT} ml-auto w-64`}
        aria-label="Search employee by name"
      />
    </div>
  );

  const toolbar = (
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
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setUploadOpen(true)} className={BTN_OUTLINE}>
          ⭱ Upload
        </button>
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
    </div>
  );

  return (
    <div className="space-y-4">
      {toolbar}

      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{actionError}</p>
      )}

      {sub === 'pending-verification' && (
        <>
          <SectionHeader title="Documents pending verification" subtitle="Documents submitted by employees for verification." />
          {filterBar()}
          <p className="text-sm text-gray-500">Total: {pendingRows.length}</p>
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm"><EmptyRow>Loading…</EmptyRow></div>
          ) : loadError ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm"><EmptyRow>{loadError}</EmptyRow></div>
          ) : (
            <Table columns={COLS['pending-verification']} rows={pendingRows} />
          )}
          {pendingRows.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={acting}
                onClick={() => void verifyAll(filterByName(pending))}
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
                onClick={() => void rejectAll(filterByName(pending))}
                className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-md disabled:opacity-50"
              >
                Reject All
              </button>
            </div>
          )}
        </>
      )}

      {sub === 'pending-employee' && (
        <>
          <SectionHeader title="Documents submission pending on employee" subtitle="Mandatory documents which are pending on employee are shown here." />
          {filterBar()}
          <p className="text-sm text-gray-500">Total: 0</p>
          <Table columns={COLS['pending-employee']} rows={[]} />
        </>
      )}

      {sub === 'verified' && (
        <>
          <SectionHeader title="Verified documents" subtitle="All the employee documents that are verified are shown here." />
          {filterBar('Employment Status')}
          <p className="text-sm text-gray-500">Total: {verifiedRows.length}</p>
          <Table columns={COLS.verified} rows={verifiedRows} />
        </>
      )}

      {sub === 'expiring' && (
        <>
          <SectionHeader title="Expiring documents" subtitle="Documents expiring in the next 30 days." />
          {filterBar()}
          <p className="text-sm text-gray-500">Total: {expiringRows.length}</p>
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm"><EmptyRow>Loading…</EmptyRow></div>
          ) : loadError ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm"><EmptyRow>{loadError}</EmptyRow></div>
          ) : (
            <Table columns={COLS.expiring} rows={expiringRows} />
          )}
        </>
      )}

      {(sub === 'bulk' || sub === 'settings') && (
        <>
          <SectionHeader
            title={sub === 'bulk' ? 'Bulk uploads' : 'Document settings'}
            subtitle={
              sub === 'bulk'
                ? 'Upload documents for many employees at once.'
                : 'Configure the document types employees are asked to submit.'
            }
            actions={
              sub === 'bulk' ? (
                <button type="button" onClick={() => setUploadOpen(true)} className={BTN_OUTLINE}>
                  ⭱ Upload
                </button>
              ) : undefined
            }
          />
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <EmptyRow>{sub === 'bulk' ? 'No bulk uploads' : 'No document types configured'}</EmptyRow>
          </div>
        </>
      )}

      {uploadOpen && (
        <UploadEmployeeDoc
          employees={employees}
          uploadEmp={uploadEmp}
          setUploadEmp={setUploadEmp}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            if (sub === 'pending-verification') void loadPending();
            else if (sub === 'expiring') void loadExpiring();
          }}
        />
      )}
    </div>
  );
}

/** Upload modal wrapper that first asks which employee the document belongs to
 * (required for employee_document rows), then reuses the shared drag-drop
 * uploader. Used for migrating existing Keka files in. */
function UploadEmployeeDoc({
  employees,
  uploadEmp,
  setUploadEmp,
  onClose,
  onUploaded,
}: {
  employees: EmployeeLite[];
  uploadEmp: string;
  setUploadEmp: (v: string) => void;
  onClose: () => void;
  onUploaded: () => void;
}) {
  if (uploadEmp) {
    return (
      <DocumentUploadModal
        title="Upload employee document"
        entityType="employee_document"
        entityId={uploadEmp}
        employeeId={Number(uploadEmp)}
        allowExpiryDate
        onUploaded={onUploaded}
        onClose={onClose}
      />
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900">Upload employee document</h3>
        <p className="text-sm text-gray-500">Select the employee this document belongs to.</p>
        <select
          value={uploadEmp}
          onChange={(e) => setUploadEmp(e.target.value)}
          className={SELECT + ' w-full'}
          aria-label="Employee"
        >
          <option value="">Select employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_OUTLINE}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
