'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { offerApi, CandidateOffer, OfferApiError } from '@/lib/api/offers';
import { formatCurrency, formatDate, formatDateTime, REJECTION_REASON_LABEL } from '@/lib/api/onboarding';
import type { OfferRejectionReason } from '@/lib/api/onboarding';
import { FileTextIcon } from '@/components/icons';

const PENDING_STATUSES = ['sent', 'viewed', 'awaiting_signature'];

export default function OfferSigningPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [offer, setOffer] = useState<CandidateOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      setLoading(true);
      setLoadError(null);
      setOffer(await offerApi.get(token));
    } catch (e) {
      setLoadError(e instanceof OfferApiError ? e.message : 'Something went wrong loading this offer.');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [token]);

  return (
    // `html`/`body` are globally locked to `overflow: hidden` (globals.css —
    // the authenticated app shell does its own internal scrolling instead),
    // so this standalone page needs its own `h-screen overflow-y-auto`
    // scroll container, same pattern as (app)/layout.tsx. Without it,
    // content taller than the viewport (e.g. reject mode's extra fields) is
    // simply unreachable — nothing on the page can scroll to it.
    <div className="h-screen overflow-y-auto bg-gray-50 font-['Inter'] py-8 px-4 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white font-bold text-base flex items-center justify-center">
            {(offer?.companyName ?? 'H').slice(0, 1).toUpperCase()}
          </div>
          <span className="text-lg font-bold text-gray-900">{offer?.companyName ?? 'Offer Letter'}</span>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-500 text-sm">
            Loading your offer…
          </div>
        )}

        {!loading && loadError && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <p className="text-lg font-bold text-gray-900 mb-2">Can&rsquo;t open this offer</p>
            <p className="text-gray-500 text-sm">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && offer && (
          <OfferView offer={offer} token={token} onUpdated={setOffer} />
        )}
      </div>
    </div>
  );
}

function OfferView({ offer, token, onUpdated }: { offer: CandidateOffer; token: string; onUpdated: (offer: CandidateOffer) => void }) {
  const isPending = PENDING_STATUSES.includes(offer.status);

  return (
    <div className="space-y-5">
      {offer.status === 'accepted' && (
        <ResultBanner tone="success" title="You've accepted this offer">
          Signed {formatDateTime(offer.signedAt)}. Welcome to the team — check your inbox for your preboarding checklist.
        </ResultBanner>
      )}
      {offer.status === 'rejected' && (
        <ResultBanner tone="neutral" title="You declined this offer">
          {offer.rejectedAt ? `Recorded ${formatDateTime(offer.rejectedAt)}. ` : ''}
          If this was a mistake, reply to your original offer email to reach the hiring team.
        </ResultBanner>
      )}
      {offer.status === 'expired' && (
        <ResultBanner tone="warning" title="This offer has expired">
          The signing window closed{offer.expiresAt ? ` on ${formatDate(offer.expiresAt)}` : ''}. Contact the hiring team if
          you&rsquo;d still like to join — they can resend it.
        </ResultBanner>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">
        <div className="flex items-start justify-between mb-1 gap-3">
          <h1 className="text-xl font-bold text-gray-900">Offer Letter</h1>
          <StatusBadge offer={offer} />
        </div>
        <p className="text-sm text-gray-500 mb-6">Offer {offer.offerNumber} · Version {offer.version}</p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 mb-6">
          <Field label="Candidate">{offer.candidateName}</Field>
          <Field label="Position">{offer.designation ?? '—'}</Field>
          <Field label="Department">{offer.department ?? '—'}</Field>
          <Field label="Joining Date">{formatDate(offer.joiningDate)}</Field>
          <Field label="Employment Type">{offer.employmentTypeDisplay}</Field>
          {offer.expiresAt && <Field label="Offer Expires">{formatDate(offer.expiresAt)}</Field>}
        </dl>

        <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">Compensation (annual CTC)</p>
          <p className="text-2xl font-bold text-purple-900 mb-2">{formatCurrency(offer.annualCtc, offer.currency)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-purple-800">
            <span>Basic: {formatCurrency(offer.basicSalary, offer.currency)}</span>
            <span>HRA: {formatCurrency(offer.hra, offer.currency)}</span>
            <span>Other allowances: {formatCurrency(offer.otherAllowances, offer.currency)}</span>
            <span>Other components: {formatCurrency(offer.otherComponents, offer.currency)}</span>
          </div>
          <p className="text-xs text-purple-700 mt-2">
            Probation: {offer.probationPeriodMonths} month(s) · Notice period: {offer.noticePeriodDays} days
          </p>
        </div>

        {offer.documentUrl && (
          <a
            href={offerApi.documentUrl(token)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-purple-600 font-semibold text-sm hover:underline mb-2"
          >
            <FileTextIcon className="w-4 h-4" />
            View Offer Letter (PDF)
          </a>
        )}

        {offer.status === 'rejected' && offer.rejectionReason && (
          <p className="text-sm text-gray-500 mt-4 pt-4 border-t border-gray-100">
            Reason: <span className="font-semibold text-gray-700">{REJECTION_REASON_LABEL[offer.rejectionReason]}</span>
          </p>
        )}
      </div>

      {isPending && <SignatureSection token={token} onUpdated={onUpdated} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900">{children}</dd>
    </div>
  );
}

function StatusBadge({ offer }: { offer: CandidateOffer }) {
  const tone: Record<string, string> = {
    accepted: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${tone[offer.status] ?? 'bg-amber-100 text-amber-700'}`}>
      {offer.statusDisplay}
    </span>
  );
}

function ResultBanner({ tone, title, children }: { tone: 'success' | 'neutral' | 'warning'; title: string; children: React.ReactNode }) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    neutral: 'bg-gray-100 border-gray-200 text-gray-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
  }[tone];
  return (
    <div className={`rounded-2xl border p-5 ${styles}`}>
      <p className="font-bold mb-1">{title}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}

const REJECTION_REASONS: OfferRejectionReason[] = [
  'compensation', 'another_offer', 'personal_reasons', 'joining_date', 'location', 'job_role', 'other',
];

function SignatureSection({ token, onUpdated }: { token: string; onUpdated: (offer: CandidateOffer) => void }) {
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [signatureName, setSignatureName] = useState('');
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState<OfferRejectionReason | ''>('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    setError(null);
    if (!signatureName.trim()) {
      setError('Type your full legal name to sign.');
      return;
    }
    if (!agree) {
      setError('Please confirm you have read and agree to the terms of this offer.');
      return;
    }
    setSubmitting(true);
    try {
      // The signing token is invalidated the instant this succeeds (see
      // backend/onboarding/services.py::accept_offer) — use the offer this
      // call returns directly rather than re-fetching by the now-dead token.
      onUpdated(await offerApi.sign(token, signatureName.trim(), agree));
    } catch (e) {
      setError(e instanceof OfferApiError ? e.message : 'Failed to sign the offer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setError(null);
    if (!reason) {
      setError('Choose a reason for declining.');
      return;
    }
    setSubmitting(true);
    try {
      // Same reasoning as handleSign above — the token is dead after this.
      onUpdated(await offerApi.reject(token, reason, comments.trim()));
    } catch (e) {
      setError(e instanceof OfferApiError ? e.message : 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">
      {mode === 'idle' ? (
        <>
          <h2 className="text-base font-bold text-gray-900 mb-4">Electronic Signature</h2>
          <label className="block mb-4">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Type your full legal name to sign</span>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-['cursive'] text-lg focus:outline-none focus:border-purple-500"
              placeholder="Your full name"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span className="text-sm text-gray-700">
              I have read and agree to the terms of this offer, and I understand that typing my name above and
              submitting constitutes my electronic signature.
            </span>
          </label>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setMode('reject')}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Reject Offer
            </button>
            <button
              type="button"
              onClick={handleSign}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Accept & Sign'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-base font-bold text-gray-900 mb-1">Reject this offer</h2>
          <p className="text-sm text-gray-500 mb-4">We&rsquo;re sorry to see this — a reason helps the team improve future offers.</p>

          <label className="block mb-4">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Reason *</span>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500"
              value={reason}
              onChange={(e) => setReason(e.target.value as OfferRejectionReason)}
            >
              <option value="">Select a reason…</option>
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>{REJECTION_REASON_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <label className="block mb-5">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Additional comments (optional)</span>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500"
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </label>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setMode('idle')}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Confirm Rejection'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
