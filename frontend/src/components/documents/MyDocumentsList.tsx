'use client';

import { useEffect, useState } from 'react';
import { documentsApi, DocumentsApiError, MyDocument, validateDocumentFile } from '@/lib/api/documents';
import { formatDate } from '@/lib/api/onboarding';
import { FileTextIcon } from '@/components/icons';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';

const CATEGORY_ORDER: MyDocument['category'][] = ['Offer letter', 'Identity', 'Education', 'Onboarding', 'Letters', 'Other'];

/** Every file on the signed-in employee's record — the signed offer letter
 * included — with view/download, and replace/delete where the backend says
 * the employee may (their own uploads, not HR-issued or verified ones). */
export function MyDocumentsList({ employeeId, refreshKey = 0, onChanged }: { employeeId: number; refreshKey?: number; onChanged?: () => void }) {
  const [docs, setDocs] = useState<MyDocument[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MyDocument | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const load = async () => {
    try {
      setDocs(await documentsApi.mine());
    } catch {
      setDocs([]);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const replace = async (doc: MyDocument, file: File) => {
    const fileError = validateDocumentFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    setError(null);
    setBusyId(doc.id);
    try {
      await documentsApi.upload(file, doc.entityType, doc.entityId, employeeId);
      await documentsApi.remove(doc.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Failed to replace document');
    } finally {
      setBusyId(null);
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
      onChanged?.();
    } catch (e) {
      setRemoveError(e instanceof DocumentsApiError ? e.message : 'Failed to delete document');
    } finally {
      setRemoveLoading(false);
    }
  };

  if (docs === null) return <p className="text-xs text-gray-400">Loading…</p>;
  if (docs.length === 0) return <p className="text-sm text-gray-500">No documents yet. Files you upload and your signed offer letter will appear here.</p>;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {CATEGORY_ORDER.map((category) => {
        const items = docs.filter((d) => d.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{category}</p>
            <div className="space-y-2">
              {items.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center gap-3 border border-gray-200 rounded-xl px-3 py-2.5 bg-white">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                    <FileTextIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {doc.originalFilename} · {formatDate(doc.uploadedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <a href={doc.viewUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-purple-600 hover:underline">View</a>
                    <a href={doc.downloadUrl} className="text-xs font-semibold text-gray-600 hover:underline">Download</a>
                    {doc.canReplace && (
                      <label className="text-xs font-semibold text-gray-600 hover:underline cursor-pointer">
                        {busyId === doc.id ? 'Replacing…' : 'Replace'}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="hidden"
                          disabled={busyId !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) replace(doc, file);
                          }}
                        />
                      </label>
                    )}
                    {doc.canDelete && (
                      <button onClick={() => setRemoveTarget(doc)} className="text-xs font-semibold text-red-500 hover:underline">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {removeTarget ? (
        <ConfirmDialog
          title="Delete document?"
          description={`"${removeTarget.originalFilename}" will be permanently removed.`}
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
