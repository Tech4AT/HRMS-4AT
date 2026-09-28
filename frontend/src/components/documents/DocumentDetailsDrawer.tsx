'use client';

import { useEffect, useRef } from 'react';
import { XIcon, AlertTriangleIcon } from '@/components/icons';
import { formatDate, formatDateTime } from '@/lib/api/onboarding';
import { formatBytes } from './DocumentUploadModal';
import { DocumentStatusBadge, type DocumentDisplayStatus } from './DocumentStatusBadge';
import { ExpiryIndicator } from './ExpiryIndicator';

export interface DocumentDetailsData {
  name: string;
  category: string;
  /** null for generic uploads that carry no verification concept (Resume,
   * Degrees & Certificates, ...) — only identity documents and anything
   * with an expiry get a real status here. */
  status: DocumentDisplayStatus | null;
  uploadedAt: string | null;
  updatedAt?: string | null;
  uploadedByName: string | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  expiryDate: string | null;
  isExpired: boolean;
  fileName: string | null;
  fileSize: number | null;
  rejectionReason?: string | null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 last:border-b-0">
      <span className="text-xs font-medium text-slate-400 shrink-0">{label}</span>
      <span className="text-sm text-slate-900 text-right">{value}</span>
    </div>
  );
}

/** Read-only metadata view, separate from the file preview (DocumentViewerModal)
 * — "View details" shows who/when/status; "View file" shows the bytes. */
export function DocumentDetailsDrawer({ data, onClose }: { data: DocumentDetailsData; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileExt = data.fileName ? data.fileName.slice(data.fileName.lastIndexOf('.') + 1).toUpperCase() : null;

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-40 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${data.name}`}
      onClick={onClose}
    >
      <div className="bg-white shadow-xl w-full max-w-sm h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-base font-bold text-slate-900">Document details</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <h3 className="text-sm font-bold text-slate-900">{data.name}</h3>
            {data.status ? <DocumentStatusBadge status={data.status} /> : null}
          </div>

          {data.status === 'rejected' && data.rejectionReason ? (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
              <AlertTriangleIcon className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">
                <span className="font-semibold">Rejection reason: </span>
                {data.rejectionReason}
              </p>
            </div>
          ) : null}

          {data.expiryDate ? (
            <div className="mb-4">
              <ExpiryIndicator expiryDate={data.expiryDate} isExpired={data.isExpired} />
            </div>
          ) : null}

          <div>
            <Row label="Category" value={data.category} />
            <Row label="File name" value={data.fileName} />
            <Row label="File type" value={fileExt} />
            <Row label="File size" value={data.fileSize != null ? formatBytes(data.fileSize) : null} />
            <Row label="Uploaded" value={data.uploadedAt ? formatDateTime(data.uploadedAt) : null} />
            <Row label="Uploaded by" value={data.uploadedByName} />
            <Row label="Last updated" value={data.updatedAt ? formatDateTime(data.updatedAt) : null} />
            <Row label="Expiry date" value={data.expiryDate ? formatDate(data.expiryDate) : null} />
            <Row label="Verified by" value={data.verifiedByName} />
            <Row label="Verified on" value={data.verifiedAt ? formatDateTime(data.verifiedAt) : null} />
          </div>
        </div>
      </div>
    </div>
  );
}
