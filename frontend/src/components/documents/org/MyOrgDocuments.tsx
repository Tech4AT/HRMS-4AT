'use client';

import { useCallback, useEffect, useState } from 'react';
import { documentsApi, DocumentsApiError, OrgDocument } from '@/lib/api/documents';
import { SectionHeading } from '@/components/ui/Heading';

/** Employee-facing Organisation Documents: the org documents an HR admin
 * pushed to this employee (audience all-employees or their role). View,
 * download, and acknowledge the ones that require it. The backend already
 * access-filters `orgVisible()` per caller and stamps each row with the
 * signed-in employee's acknowledgement state. */
export function MyOrgDocuments() {
  const [docs, setDocs] = useState<OrgDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await documentsApi.orgVisible());
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async (doc: OrgDocument) => {
    const id = String(doc.id);
    setAcking(id);
    try {
      await documentsApi.acknowledge(doc.id);
      setDocs((prev) =>
        prev.map((d) =>
          String(d.id) === id ? { ...d, acknowledged: true, acknowledgedAt: new Date().toISOString() } : d,
        ),
      );
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Failed to acknowledge document');
    } finally {
      setAcking(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading>Organisation Documents</SectionHeading>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-500">No organisation documents have been shared with you.</p>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const name = doc.title || doc.originalFilename || 'Document';
            const needsAck = !!doc.mustAcknowledge && !doc.acknowledged;
            return (
              <div
                key={doc.id}
                className="flex flex-wrap items-start justify-between gap-3 border border-gray-200 rounded-lg bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{name}</span>
                    {doc.acknowledged ? (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        Acknowledged{doc.acknowledgedAt ? ` · ${new Date(doc.acknowledgedAt).toLocaleDateString()}` : ''}
                      </span>
                    ) : needsAck ? (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        Needs acknowledgement
                      </span>
                    ) : null}
                  </div>
                  {doc.description ? <p className="mt-0.5 text-xs text-gray-500">{doc.description}</p> : null}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {doc.viewUrl ? (
                    <a
                      href={doc.viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      View
                    </a>
                  ) : null}
                  {doc.downloadUrl ? (
                    <a
                      href={doc.downloadUrl}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Download
                    </a>
                  ) : null}
                  {needsAck ? (
                    <button
                      type="button"
                      onClick={() => acknowledge(doc)}
                      disabled={acking === String(doc.id)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {acking === String(doc.id) ? 'Acknowledging…' : 'Acknowledge'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
