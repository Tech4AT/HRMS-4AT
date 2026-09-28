'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import {
  onboardingApi,
  type BackgroundVerification,
  type OnboardingRecord,
} from '@/lib/api/onboarding';
import { PageHeader, StatusPill } from '@/components/org-module/ui';

interface BgvRow {
  recordId: number;
  candidate: string;
  code: string;
  bgv: BackgroundVerification;
}

/** Background verification cases, live from onboarding records that carry a
 * verification. Pass/fail decisions save through the real endpoint. Records
 * without a verification are not listed — no sample rows. */
export default function BgvPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [rows, setRows] = useState<BgvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const list = await onboardingApi.getRecords();
      const details: OnboardingRecord[] = await Promise.all(
        list.map((r) => onboardingApi.getRecord(r.id)),
      );
      setRows(
        details
          .filter((d) => d.backgroundVerification !== null)
          .map((d) => ({
            recordId: d.id,
            candidate: d.employee.name,
            code: d.employee.employeeCode,
            bgv: d.backgroundVerification as BackgroundVerification,
          })),
      );
    } catch {
      setRows([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function decide(recordId: number, status: 'passed' | 'failed') {
    setBusy(recordId);
    setError(null);
    try {
      await onboardingApi.decideBackgroundVerification(recordId, status);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Background Verification"
          subtitle="Verification cases live from onboarding records (decisions save through the real endpoint)."
        />
      </div>

      {loadFailed ? (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">Couldn&apos;t reach the onboarding records.</p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          {error}
        </p>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Verification cases</h3>
          <span className="text-xs text-slate-500">
            {loading ? 'Loading…' : `Showing ${rows.length} cases`}
          </span>
        </div>
        {loading ? (
          <div className="p-5 space-y-2 animate-pulse">
            <div className="h-10 bg-slate-50 rounded-xl" />
            <div className="h-10 bg-slate-50 rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            No background verification cases.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Candidate', 'Status', 'Documents', 'Reviewed by', 'Decided'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                  {canManage ? (
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">
                      Decide
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.recordId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-slate-900">{r.candidate}</p>
                      <p className="text-xs text-slate-500">{r.code}</p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill
                        value={
                          r.bgv.status === 'passed'
                            ? 'Completed'
                            : r.bgv.status === 'failed'
                              ? 'Inactive'
                              : 'Pending'
                        }
                      />
                      <p className="text-xs text-slate-500 mt-1">{r.bgv.statusDisplay}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {r.bgv.documentsSubmitted}/{r.bgv.documentCount} submitted
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {r.bgv.reviewedByName ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {r.bgv.reviewedAt ? r.bgv.reviewedAt.slice(0, 10) : '—'}
                    </td>
                    {canManage ? (
                      <td className="px-5 py-3 text-sm">
                        {r.bgv.status === 'passed' || r.bgv.status === 'failed' ? (
                          <span className="text-xs text-slate-400">Decided</span>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              type="button"
                              disabled={busy === r.recordId}
                              onClick={() => decide(r.recordId, 'passed')}
                              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-60"
                            >
                              Pass
                            </button>
                            <button
                              type="button"
                              disabled={busy === r.recordId}
                              onClick={() => decide(r.recordId, 'failed')}
                              className="text-xs font-semibold text-rose-700 hover:text-rose-800 disabled:opacity-60"
                            >
                              Fail
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
