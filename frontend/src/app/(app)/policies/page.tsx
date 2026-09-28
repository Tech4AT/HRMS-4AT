'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { policiesApi, PoliciesApiError, CompanyPolicy, PolicyAcknowledgment } from '@/lib/api/policies';
import { validateDocumentFile } from '@/lib/api/documents';
import { PlusIcon } from '@/components/icons';

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PoliciesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const isHrAdmin = user?.role === 'superadmin';

  const [policies, setPolicies] = useState<CompanyPolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewAcks, setViewAcks] = useState<CompanyPolicy | null>(null);

  useEffect(() => {
    if (!isLoading && !isHrAdmin) router.push('/');
  }, [isLoading, isHrAdmin, router]);

  const load = async () => {
    try {
      setError(null);
      setPolicies(await policiesApi.adminList());
    } catch (e) {
      setError(e instanceof PoliciesApiError ? e.message : 'Failed to load policies');
    }
  };

  useEffect(() => {
    if (isHrAdmin) load();
  }, [isHrAdmin]);

  const deactivate = async (id: number) => {
    if (!confirm('Deactivate this policy? Employees will no longer see it.')) return;
    try {
      await policiesApi.deactivate(id);
      load();
    } catch (e) {
      alert(e instanceof PoliciesApiError ? e.message : 'Failed to deactivate');
    }
  };

  if (isLoading || !isHrAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Company Policies</h1>
          <p className="text-sm text-gray-500">Publish policies employees must read and acknowledge.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700"
        >
          <PlusIcon className="w-4 h-4" />
          Add Policy
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {policies === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : policies.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-500">
          No policies yet. Add your first policy above.
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((p) => (
            <div key={p.id} className={`bg-white rounded-2xl border p-5 ${!p.isActive ? 'opacity-60' : 'border-gray-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-gray-900">{p.title}</h3>
                    {!p.isActive && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">Deactivated</span>}
                    {p.requiresAcknowledgment && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">Requires acknowledgment</span>}
                  </div>
                  {p.description && <p className="text-sm text-gray-600 mt-1">{p.description}</p>}
                  <p className="text-xs text-gray-400 mt-1.5">
                    Added {formatDate(p.createdAt)}
                    {p.acknowledgmentCount != null && ` · ${p.acknowledgmentCount} acknowledgment${p.acknowledgmentCount !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.acknowledgmentCount != null && p.acknowledgmentCount > 0 && (
                    <button
                      onClick={() => setViewAcks(p)}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                    >
                      View acknowledgments
                    </button>
                  )}
                  {p.documentUrl && (
                    <a
                      href={p.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                    >
                      View PDF
                    </a>
                  )}
                  {p.isActive && (
                    <button
                      onClick={() => deactivate(p.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreatePolicyDialog
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); load(); }}
        />
      )}

      {viewAcks && (
        <AcknowledgmentsDialog policy={viewAcks} onClose={() => setViewAcks(null)} />
      )}
    </div>
  );
}

function CreatePolicyDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requiresAck, setRequiresAck] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileError(f ? validateDocumentFile(f) : null);
  };

  const uploadPolicyDoc = async (f: File): Promise<number> => {
    const form = new FormData();
    form.append('file', f);
    form.append('entityType', 'company_policy');
    form.append('entityId', 'global');
    const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const raw = json?.error?.message;
      throw new Error(Array.isArray(raw) ? raw.join(', ') : raw || 'Upload failed');
    }
    return json.data.id as number;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Title is required'); return; }
    if (file && fileError) { setError(fileError); return; }
    setBusy(true);
    try {
      let documentId: number | null = null;
      if (file) documentId = await uploadPolicyDoc(file);
      await policiesApi.create({ title: title.trim(), description: description.trim(), documentId, requiresAcknowledgment: requiresAck });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create policy');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">New Policy</h2>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Title *</span>
            <input type="text" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Code of Conduct" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Description</span>
            <textarea className={inputClass} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief summary of this policy…" />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Policy document (PDF/image, optional)</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} className="block w-full text-sm text-gray-600" />
            {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm text-gray-700">Require employees to acknowledge this policy</span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AcknowledgmentsDialog({ policy, onClose }: { policy: CompanyPolicy; onClose: () => void }) {
  const [acks, setAcks] = useState<PolicyAcknowledgment[] | null>(null);

  useEffect(() => {
    policiesApi.acknowledgments(policy.id)
      .then(setAcks)
      .catch(() => setAcks([]));
  }, [policy.id]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Acknowledgments</h2>
        <p className="text-sm text-gray-500 mb-4">{policy.title}</p>
        <div className="flex-1 overflow-y-auto">
          {acks === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : acks.length === 0 ? (
            <p className="text-sm text-gray-500">No acknowledgments yet.</p>
          ) : (
            <div className="space-y-2">
              {acks.map((a) => (
                <div key={a.employeeId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{a.employeeName}</p>
                    <p className="text-xs text-gray-400">{a.employeeCode}</p>
                  </div>
                  <p className="text-xs text-gray-500">{formatDate(a.acknowledgedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 w-full">Close</button>
      </div>
    </div>
  );
}
