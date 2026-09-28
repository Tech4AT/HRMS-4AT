'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  formatWhen,
  humanizeAction,
  type AuditEntry,
  type Page,
} from '@/lib/admin/api';

const PAGE_SIZE = 10;

/** "2026-09-28T…" -> "Sep 2026": the month bucket the entry belongs to. */
function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function AuditLogsTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AuditEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.listAudit({ page, pageSize: PAGE_SIZE }));
      setError(null);
      setForbidden(false);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load audit logs.');
      }
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Audit logs</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Track and review all user actions and changes within the system
          </p>
        </div>
        <span title="There is no audit-create endpoint — entries are written automatically by the system">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white opacity-40 cursor-not-allowed"
          >
            Create Audit log
          </button>
        </span>
      </div>

      <div className="mt-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h4 className="text-sm font-bold text-slate-900">This Month</h4>
        </div>

        {forbidden ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            You don&apos;t have access to audit logs — they need the audit read
            permission.
          </p>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-500">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !data ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
        ) : data.results.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Created On', 'Date Range', 'Category', 'Sub Category', 'Event'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {formatWhen(e.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {monthLabel(e.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{e.entityType || '—'}</td>
                    <td className="px-5 py-3 text-slate-500">
                      {e.entityId ? `#${e.entityId}` : '—'}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-900">
                      {humanizeAction(e.action)}
                      {e.actorName ? (
                        <span className="block text-xs font-normal text-slate-500">
                          by {e.actorName}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && !forbidden && !error && data.results.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Page {data.page} of {totalPages} · {from} to {to} of {total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
