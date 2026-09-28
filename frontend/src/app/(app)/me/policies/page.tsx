'use client';

import { useEffect, useState } from 'react';
import { policiesApi, PoliciesApiError, CompanyPolicy } from '@/lib/api/policies';

export default function MyPoliciesPage() {
  const [policies, setPolicies] = useState<CompanyPolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState<number | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  const load = async () => {
    try {
      setPolicies(await policiesApi.list());
    } catch (e) {
      setError(e instanceof PoliciesApiError ? e.message : 'Failed to load policies');
    }
  };

  useEffect(() => { load(); }, []);

  const acknowledge = async (id: number) => {
    setAcking(id);
    setAckError(null);
    try {
      await policiesApi.acknowledge(id);
      setPolicies((prev) => prev ? prev.map((p) => p.id === id ? { ...p, acknowledged: true } : p) : prev);
    } catch (e) {
      setAckError(e instanceof PoliciesApiError ? e.message : 'Failed to acknowledge');
    } finally {
      setAcking(null);
    }
  };

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (policies === null) return <div className="p-8 text-sm text-gray-500">Loading…</div>;

  const pending = policies.filter((p) => p.requiresAcknowledgment && !p.acknowledged);
  const acknowledged = policies.filter((p) => p.acknowledged);
  const noAck = policies.filter((p) => !p.requiresAcknowledgment && !p.acknowledged);

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
      {ackError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{ackError}</div>
      )}

      {policies.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
          </svg>
          <p className="text-sm text-gray-500">No policies published yet.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Requires your acknowledgment ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((p) => (
              <PolicyCard key={p.id} policy={p} onAcknowledge={acknowledge} acking={acking === p.id} />
            ))}
          </div>
        </section>
      )}

      {noAck.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">For your reference</h2>
          <div className="space-y-3">
            {noAck.map((p) => (
              <PolicyCard key={p.id} policy={p} onAcknowledge={acknowledge} acking={acking === p.id} />
            ))}
          </div>
        </section>
      )}

      {acknowledged.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Acknowledged ({acknowledged.length})
          </h2>
          <div className="space-y-3">
            {acknowledged.map((p) => (
              <PolicyCard key={p.id} policy={p} onAcknowledge={acknowledge} acking={acking === p.id} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PolicyCard({
  policy,
  onAcknowledge,
  acking,
}: {
  policy: CompanyPolicy;
  onAcknowledge: (id: number) => void;
  acking: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-white rounded-2xl border p-5 ${policy.acknowledged ? 'border-emerald-200' : policy.requiresAcknowledgment ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900">{policy.title}</h3>
            {policy.acknowledged && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">✓ Acknowledged</span>
            )}
          </div>
          {policy.description && (
            <p className={`text-sm text-gray-600 mt-1.5 ${expanded ? '' : 'line-clamp-2'}`}>{policy.description}</p>
          )}
          {policy.description && policy.description.length > 120 && (
            <button onClick={() => setExpanded(!expanded)} className="text-xs text-indigo-600 mt-1 font-medium hover:underline">
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {policy.documentUrl && (
            <a
              href={policy.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
            >
              View PDF
            </a>
          )}
          {policy.requiresAcknowledgment && !policy.acknowledged && (
            <button
              onClick={() => onAcknowledge(policy.id)}
              disabled={acking}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {acking ? 'Saving…' : 'I Acknowledge'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
