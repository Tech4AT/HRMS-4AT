'use client';

import { useCallback, useEffect, useState } from 'react';
import { documentsApi, DocumentsApiError, PendingAckDoc } from '@/lib/api/documents';

/** Employee-side acknowledgement inbox: docs from
 * GET pending-acknowledgement, each with an Acknowledge button that POSTs
 * acknowledge and refreshes. Returns null when there is nothing pending —
 * and stays silent (no error chrome) when Parcel A's endpoint isn't there
 * yet (404), so pre-backend renders stay clean. */
export function PendingAcknowledgements({ onChanged }: { onChanged?: () => void }) {
  const [docs, setDocs] = useState<PendingAckDoc[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [ackingId, setAckingId] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await documentsApi.pendingAcknowledgement());
      setUnavailable(false);
    } catch (e) {
      if (e instanceof DocumentsApiError && (e.status === 404 || e.status === 501)) {
        setUnavailable(true);
        setDocs([]);
      } else {
        setDocs([]);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (doc: PendingAckDoc) => {
    setAckingId(doc.id);
    setError(null);
    try {
      await documentsApi.acknowledge(doc.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof DocumentsApiError ? e.message : 'Failed to acknowledge');
    } finally {
      setAckingId(null);
    }
  };

  if (unavailable || docs === null || docs.length === 0) return null;

  return (
    <section
      aria-label="Documents awaiting your acknowledgement"
      className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 space-y-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-amber-900">
          {docs.length} document{docs.length === 1 ? '' : 's'} awaiting your acknowledgement
        </h3>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center gap-3 bg-white border border-amber-100 rounded-xl px-4 py-2.5 flex-wrap"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {d.title || d.originalFilename || 'Untitled document'}
              </p>
              {d.description && <p className="text-xs text-gray-500 truncate">{d.description}</p>}
            </div>
            <button
              type="button"
              disabled={ackingId !== null}
              onClick={() => acknowledge(d)}
              className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ackingId === d.id ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
