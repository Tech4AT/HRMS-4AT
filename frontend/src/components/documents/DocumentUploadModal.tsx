'use client';

import { useEffect, useRef, useState } from 'react';
import { documentsApi, validateDocumentFile, ALLOWED_DOCUMENT_EXTENSIONS, DocumentsApiError, type UploadedDocument } from '@/lib/api/documents';
import { UploadCloudIcon, FileTextIcon, XIcon } from '@/components/icons';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Drag-and-drop upload modal reused everywhere a plain file needs
 * attaching to a document folder (Resume, Degrees & Certificates, Previous
 * Experience, and from the Pending Documents list) — client-side type/size
 * validation mirrors backend/documents/views.py's, real upload progress via
 * `documentsApi.uploadWithProgress` (XHR, not fetch — see lib/api/documents.ts). */
export function DocumentUploadModal({
  title,
  entityType,
  entityId,
  employeeId,
  allowExpiryDate = false,
  onUploaded,
  onClose,
}: {
  title: string;
  entityType: string;
  entityId: string | number;
  employeeId: number;
  allowExpiryDate?: boolean;
  onUploaded: (doc: UploadedDocument) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const uploading = progress !== null && progress < 100;

  useEffect(() => {
    browseRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [uploading, onClose]);

  const chooseFile = (f: File | undefined | null) => {
    if (!f) return;
    const validationError = validateDocumentFile(f);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setError('');
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      const doc = await documentsApi.uploadWithProgress(file, entityType, entityId, employeeId, setProgress, expiryDate || null);
      onUploaded(doc);
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Upload failed');
      setProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={uploading ? undefined : onClose}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                chooseFile(e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors ${
                dragOver ? 'border-[#5B45B5] bg-[#5B45B5]/5' : 'border-slate-300'
              }`}
            >
              <UploadCloudIcon className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-1">Drag and drop a file here, or</p>
              <button
                ref={browseRef}
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-sm font-semibold text-[#5B45B5] hover:underline"
              >
                Browse files
              </button>
              <p className="text-xs text-slate-400 mt-3">
                {ALLOWED_DOCUMENT_EXTENSIONS.map((e) => e.slice(1).toUpperCase()).join(', ')} up to 10 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept={ALLOWED_DOCUMENT_EXTENSIONS.join(',')}
                onChange={(e) => chooseFile(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 border border-slate-200 rounded-xl px-4 py-3">
              <FileTextIcon className="w-5 h-5 text-[#5B45B5] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
              </div>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setProgress(null);
                  }}
                  aria-label="Remove selected file"
                  className="text-slate-400 hover:text-red-600 shrink-0"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {progress !== null ? (
            <div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#5B45B5] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{progress < 100 ? `Uploading… ${progress}%` : 'Finishing…'}</p>
            </div>
          ) : null}

          {allowExpiryDate ? (
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Expiry date (optional)
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={uploading}
                className="w-full px-3 py-2 text-sm font-medium text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:border-[#5B45B5] focus:ring-2 focus:ring-[#5B45B5]/10"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex-1 px-4 py-2.5 bg-[#5B45B5] text-white rounded-lg hover:bg-[#4E3BA3] font-medium text-sm disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
