'use client';

import { useEffect, useRef, useState } from 'react';
import { DownloadIcon, FileTextIcon, XIcon, ZoomInIcon, ZoomOutIcon, AlertTriangleIcon } from '@/components/icons';

export interface ViewableDocument {
  originalFilename: string;
  viewUrl: string | null;
  downloadUrl: string | null;
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

/** In-app preview for a document's protected file — a PDF renders in an
 * iframe (the browser's own PDF viewer), an image gets a zoomable <img>,
 * anything else falls back to filename + Download. Never links to a raw
 * storage URL — `viewUrl`/`downloadUrl` are always the authenticated
 * `/api/documents/{id}/file` endpoint (see lib/api/documents.ts). */
export function DocumentViewerModal({ document: doc, onClose }: { document: ViewableDocument; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(doc.viewUrl ? 'loading' : 'error');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const ext = extensionOf(doc.originalFilename);
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  const isPreviewable = isPdf || isImage;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${doc.originalFilename}`}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileTextIcon className="w-4 h-4 text-slate-400 shrink-0" />
            <p className="text-sm font-semibold text-slate-900 truncate" title={doc.originalFilename}>
              {doc.originalFilename}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isImage ? (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  aria-label="Zoom out"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <ZoomOutIcon className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                  aria-label="Zoom in"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <ZoomInIcon className="w-4 h-4" />
                </button>
              </>
            ) : null}
            {doc.downloadUrl ? (
              <a
                href={doc.downloadUrl}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50"
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                Download
              </a>
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-slate-50 overflow-auto flex items-center justify-center relative">
          {!doc.viewUrl || loadState === 'error' ? (
            <div className="flex flex-col items-center text-center px-6 py-16">
              <AlertTriangleIcon className="w-8 h-8 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-700 mb-1">
                {doc.viewUrl ? 'This file could not be loaded' : 'This file could not be found'}
              </p>
              <p className="text-xs text-slate-400 mb-4">{doc.originalFilename}</p>
              {doc.downloadUrl ? (
                <a
                  href={doc.downloadUrl}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#5B45B5] rounded-lg px-4 py-2 hover:bg-[#4E3BA3]"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  Download file
                </a>
              ) : null}
            </div>
          ) : isPreviewable ? (
            <>
              {loadState === 'loading' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-50" aria-live="polite">
                  <div className="w-8 h-8 border-2 border-slate-200 border-t-[#5B45B5] rounded-full animate-spin" />
                  <span className="sr-only">Loading preview…</span>
                </div>
              ) : null}
              {isPdf ? (
                <iframe
                  src={doc.viewUrl}
                  title={doc.originalFilename}
                  className={`w-full h-full border-0 ${loadState === 'loading' ? 'invisible' : ''}`}
                  onLoad={() => setLoadState('loaded')}
                />
              ) : (
                <div className={`p-6 overflow-auto max-w-full max-h-full ${loadState === 'loading' ? 'invisible' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- protected, auth-gated URL, not an optimizable static asset */}
                  <img
                    src={doc.viewUrl}
                    alt={doc.originalFilename}
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                    className="max-w-none transition-transform"
                    onLoad={() => setLoadState('loaded')}
                    onError={() => setLoadState('error')}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center text-center px-6 py-16">
              <FileTextIcon className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-700 mb-1">Preview not available for this file type</p>
              <p className="text-xs text-slate-400 mb-4">{doc.originalFilename}</p>
              {doc.downloadUrl ? (
                <a
                  href={doc.downloadUrl}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#5B45B5] rounded-lg px-4 py-2 hover:bg-[#4E3BA3]"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  Download file
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
