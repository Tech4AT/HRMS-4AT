'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import {
  requestsApi,
  type ApprovalRequest,
} from '@/lib/api/requests';

type Tab = 'to-approve' | 'mine';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function payloadSummary(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  withdrawn: 'bg-slate-100 text-slate-600',
};

export default function ApprovalsPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('to-approve');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'to-approve' || t === 'mine') setTab(t);
  }, [searchParams]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRequests(await requestsApi.list());
    } catch {
      // Never an error screen: fall back to empty states with a retry affordance.
      setRequests([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = useCallback(
    async (id: string, fn: (id: string, note?: string) => Promise<unknown>) => {
      setActingId(id);
      setActionError(null);
      try {
        await fn(id, notes[id] ?? '');
        setNotes((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'That action failed. Try again.');
      } finally {
        setActingId(null);
      }
    },
    [notes, refresh],
  );

  const me = user?.id ?? null;
  const toApprove = requests.filter((r) => r.status === 'pending' && me != null && r.approver === me);
  const mine = requests.filter((r) => me != null && r.requester === me);

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      {/* Section tabs come from the uniform sub-nav in the app layout, driven by
          the ?tab= query this page reads above. */}
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        {actionError ? (
          <p role="alert" className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-500">Loading requests...</p>
        ) : tab === 'to-approve' ? (
          toApprove.length === 0 ? (
            <EmptyState
              title="Nothing waiting for your approval"
              body={
                loadFailed
                  ? 'We could not load requests right now.'
                  : 'Requests routed to you will show up here.'
              }
              retry={loadFailed ? refresh : undefined}
            />
          ) : (
            <ul className="space-y-3">
              {toApprove.map((r) => (
                <li key={r.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 capitalize">
                        {r.requestType} request
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Raised {formatDate(r.createdAt)} · {payloadSummary(r.payload)}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyles[r.status]}`}>
                      {r.status}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Add a note (optional)"
                    aria-label={`Decision note for ${r.requestType} request`}
                    className="mt-3 w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={actingId === r.id}
                      onClick={() => act(r.id, (id, note) => requestsApi.approve(id, note))}
                      className="px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {actingId === r.id ? 'Working...' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={actingId === r.id}
                      onClick={() => act(r.id, (id, note) => requestsApi.reject(id, note))}
                      className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      {actingId === r.id ? 'Working...' : 'Reject'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-4">
            <RaiseRequest onCreated={refresh} />
            {mine.length === 0 ? (
              <EmptyState
                title="You have not raised any requests"
                body={
                  loadFailed
                    ? 'We could not load requests right now.'
                    : 'Requests you raise (leave, expenses, assets…) will show up here.'
                }
                retry={loadFailed ? refresh : undefined}
              />
            ) : (
              <ul className="space-y-3">
                {mine.map((r) => (
              <li key={r.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 capitalize">
                      {r.requestType} request
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Raised {formatDate(r.createdAt)} · {payloadSummary(r.payload)}
                    </p>
                    {r.decisionNote ? (
                      <p className="text-xs text-slate-600 mt-1">Note: {r.decisionNote}</p>
                    ) : null}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyles[r.status]}`}>
                    {r.status}
                  </span>
                </div>
                {r.status === 'pending' ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={actingId === r.id}
                      onClick={() => act(r.id, (id) => requestsApi.withdraw(id))}
                      className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      {actingId === r.id ? 'Working...' : 'Withdraw'}
                    </button>
                  </div>
                ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const REQUEST_TYPES = ['leave', 'wfh', 'expense', 'asset', 'other'] as const;

function RaiseRequest({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('leave');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (reason.trim()) payload.reason = reason.trim();
      if (from) payload.from = from;
      if (to) payload.to = to;
      await requestsApi.create(type, payload);
      setReason('');
      setFrom('');
      setTo('');
      setOpen(false);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise the request. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
      >
        Raise a request
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-900">Raise a request</p>
      {error ? (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-slate-500">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 block px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl capitalize focus:outline-none focus:bg-white focus:border-slate-300"
          >
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
          />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
          />
        </label>
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        aria-label="Reason"
        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setOpen(false)}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  retry,
}: {
  title: string;
  body: string;
  retry?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{body}</p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="mt-4 px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
