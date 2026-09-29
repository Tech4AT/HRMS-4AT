'use client';

import { ReactNode, useState } from 'react';
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

const BASE = ['Group', 'Employee', 'Job title', 'Document title', 'Department', 'Sub department', 'Location'];
const TABLES: Partial<Record<SubKey, { subtitle?: string; cols: string[]; bulk?: string[]; empty: string }>> = {
  'pending-verification': {
    cols: [...BASE, 'Date of submission', 'Actions'],
    bulk: ['Verify All', 'Reject All'],
    empty: 'Nothing pending verification',
  },
  'pending-employee': {
    subtitle: 'Mandatory documents which are pending on employee',
    cols: [...BASE, 'Actions'],
    bulk: ['Nudge All'],
    empty: 'Nothing pending on employees',
  },
  expiring: { cols: [...BASE, 'Expiration date', 'Actions'], empty: 'No documents expiring' },
};
const FILTERS = ['Business Unit', 'Department', 'Location', 'Cost Center', 'Legal Entity', 'Document Type'];

/** Keka "Employee documents". Verified Documents shows the live per-employee
 * file store (passed in as `verified`); the verification workflow, nudges,
 * expiry and bulk upload have no backend yet and render as disabled chrome. */
export function EmployeeDocumentsTab({ verified }: { verified: ReactNode }) {
  const [sub, setSub] = useState<SubKey>('verified');
  const [by, setBy] = useState<'employee' | 'document'>('employee');
  const t = TABLES[sub];

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
      ) : t ? (
        <>
          <SectionHeader title={SUBS.find((s) => s.key === sub)!.label} subtitle={t.subtitle} />
          <div className="flex items-center gap-3 flex-wrap">
            {FILTERS.map((f) => (
              <select key={f} disabled className={SELECT} aria-label={f}><option>{f}</option></select>
            ))}
            <input disabled placeholder="Search" className={`${SELECT} ml-auto w-56`} aria-label="Search" />
          </div>
          <p className="text-sm text-gray-500">Total: 0</p>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{t.cols.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
              </thead>
            </table>
            <EmptyRow>{t.empty}</EmptyRow>
          </div>
          {t.bulk && (
            <p className="text-xs text-gray-400">{t.bulk.join(' / ')} become available when documents are pending.</p>
          )}
        </>
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
