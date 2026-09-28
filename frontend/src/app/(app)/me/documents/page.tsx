'use client';

import { useEffect, useState, useMemo } from 'react';
import { documentsApi, MyDocument } from '@/lib/api/documents';
import { policiesApi, PoliciesApiError, CompanyPolicy } from '@/lib/api/policies';

const CATEGORY_ORDER = ['Offer letter', 'Identity', 'Education', 'Letters', 'Onboarding', 'Other'];

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  'Offer letter': <FolderIcon color="#7c3aed" />,
  Identity: <FolderIcon color="#d97706" />,
  Education: <FolderIcon color="#059669" />,
  Letters: <FolderIcon color="#2563eb" />,
  Onboarding: <FolderIcon color="#0891b2" />,
  Other: <FolderIcon color="#64748b" />,
};

interface OnboardingTask {
  id: string;
  title: string;
  taskType: string;
  status: string;
}

function FolderIcon({ color = '#64748b' }: { color?: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill={color}>
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function FileDocIcon() {
  return (
    <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
    </svg>
  );
}

function PolicyIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
    </svg>
  );
}

export default function MyDocumentsPage() {
  const [docs, setDocs] = useState<MyDocument[] | null>(null);
  const [policies, setPolicies] = useState<CompanyPolicy[] | null>(null);
  const [onboardingTasks, setOnboardingTasks] = useState<OnboardingTask[]>([]);
  const [activeView, setActiveView] = useState<'pending' | 'policies' | string>('pending');
  const [search, setSearch] = useState('');
  const [acking, setAcking] = useState<number | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    documentsApi.mine().then(setDocs).catch(() => setDocs([]));
    policiesApi.list().then(setPolicies).catch(() => setPolicies([]));

    fetch('/api/onboarding/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && b.data) {
          const tasks: OnboardingTask[] = b.data.tasks ?? [];
          setOnboardingTasks(tasks.filter((t) => t.taskType === 'document_upload' && t.status !== 'done'));
        }
      })
      .catch(() => {});
  }, []);

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

  const pendingCount = onboardingTasks.length;
  const pendingPolicies = (policies ?? []).filter((p) => p.requiresAcknowledgment && !p.acknowledged).length;

  const folderGroups = useMemo(() => {
    if (!docs) return [];
    const map = new Map<string, MyDocument[]>();
    for (const doc of docs) {
      const list = map.get(doc.category) ?? [];
      list.push(doc);
      map.set(doc.category, list);
    }
    return CATEGORY_ORDER
      .filter((cat) => map.has(cat))
      .map((cat) => ({ category: cat, docs: map.get(cat)! }));
  }, [docs]);

  const filteredDocs = useMemo(() => {
    if (typeof activeView !== 'string' || activeView === 'pending' || activeView === 'policies') return [];
    const categoryDocs = folderGroups.find((g) => g.category === activeView)?.docs ?? [];
    if (!search.trim()) return categoryDocs;
    const q = search.toLowerCase();
    return categoryDocs.filter((d) => d.title.toLowerCase().includes(q) || d.originalFilename.toLowerCase().includes(q));
  }, [activeView, folderGroups, search]);

  const filteredPolicies = useMemo(() => {
    if (activeView !== 'policies') return [];
    if (!search.trim()) return policies ?? [];
    const q = search.toLowerCase();
    return (policies ?? []).filter((p) => p.title.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
  }, [activeView, policies, search]);

  const filteredTasks = useMemo(() => {
    if (activeView !== 'pending') return [];
    if (!search.trim()) return onboardingTasks;
    const q = search.toLowerCase();
    return onboardingTasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [activeView, onboardingTasks, search]);

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div className="flex h-full bg-white font-['Inter']">
      {/* Left Sidebar */}
      <aside className="w-64 shrink-0 border-r border-gray-200 flex flex-col bg-white overflow-y-auto">
        {/* Search */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-300"
            />
          </div>
        </div>

        <div className="flex-1 p-3 space-y-5">
          {/* ACTIONS */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-2">Actions</p>
            <div className="space-y-0.5">
              <button
                onClick={() => setActiveView('pending')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeView === 'pending' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <WarningIcon />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-semibold truncate">Upload pending</div>
                  {pendingCount > 0 && (
                    <div className="text-[11px] text-gray-500">{pendingCount} document{pendingCount !== 1 ? 's' : ''}</div>
                  )}
                </div>
                {pendingCount > 0 && (
                  <span className="shrink-0 w-5 h-5 text-[10px] font-bold rounded-full bg-amber-500 text-white flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveView('policies')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeView === 'policies' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className={activeView === 'policies' ? 'text-indigo-600' : 'text-gray-400'}>
                  <PolicyIcon />
                </span>
                <div className="flex-1 text-left min-w-0">
                  <div className="font-semibold truncate">Company Policies</div>
                  {pendingPolicies > 0 && (
                    <div className="text-[11px] text-gray-500">{pendingPolicies} to acknowledge</div>
                  )}
                </div>
                {pendingPolicies > 0 && (
                  <span className="shrink-0 w-5 h-5 text-[10px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                    {pendingPolicies}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* FOLDERS */}
          {folderGroups.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-2">Folders</p>
              <div className="space-y-0.5">
                {folderGroups.map(({ category, docs: categoryDocs }) => (
                  <button
                    key={category}
                    onClick={() => setActiveView(category)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      activeView === category ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {CATEGORY_ICON[category] ?? <FolderIcon />}
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-medium truncate">{category}</div>
                      <div className="text-[11px] text-gray-400">{categoryDocs.length} document{categoryDocs.length !== 1 ? 's' : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Pending Documents View */}
        {activeView === 'pending' && (
          <div>
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Documents pending for upload</h2>
              {pendingCount > 0 && <p className="text-sm text-gray-500 mt-0.5">{pendingCount} document{pendingCount !== 1 ? 's' : ''}</p>}
              <p className="text-xs text-gray-400 mt-1">List of all the documents that need to be uploaded or verified</p>
            </div>

            <div className="p-6">
              {onboardingTasks.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mb-3 text-green-500">
                    <CheckIcon />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">All caught up!</p>
                  <p className="text-xs text-gray-400 mt-1">No pending document uploads in your onboarding checklist.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
                  {filteredTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between px-5 py-4 gap-4 hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                          <FileDocIcon />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{task.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                              Mandatory
                            </span>
                          </div>
                        </div>
                      </div>
                      <button className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 text-xs font-semibold hover:bg-indigo-50 transition-colors">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                        Add details
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Policies View */}
        {activeView === 'policies' && (
          <div>
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Company Policies</h2>
              {pendingPolicies > 0 && (
                <p className="text-sm text-amber-600 font-medium mt-0.5">{pendingPolicies} polic{pendingPolicies !== 1 ? 'ies require' : 'y requires'} your acknowledgment</p>
              )}
            </div>

            <div className="p-6">
              {ackError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{ackError}</div>
              )}

              {policies === null ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : filteredPolicies.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-3 text-indigo-400">
                    <PolicyIcon />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No policies published yet</p>
                  <p className="text-xs text-gray-400 mt-1">Company policies will appear here when published by HR.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPolicies.map((p) => (
                    <div
                      key={p.id}
                      className={`bg-white border rounded-xl p-5 ${
                        p.acknowledged ? 'border-green-200' : p.requiresAcknowledgment ? 'border-amber-200' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-gray-900">{p.title}</h3>
                            {p.acknowledged && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">
                                <CheckIcon /> Acknowledged
                              </span>
                            )}
                            {p.requiresAcknowledgment && !p.acknowledged && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
                                Action required
                              </span>
                            )}
                          </div>
                          {p.description && <p className="text-sm text-gray-600 mt-1.5">{p.description}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                          {p.requiresAcknowledgment && !p.acknowledged && (
                            <button
                              onClick={() => acknowledge(p.id)}
                              disabled={acking === p.id}
                              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {acking === p.id ? 'Saving…' : 'I Acknowledge'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Folder / Category View */}
        {activeView !== 'pending' && activeView !== 'policies' && (
          <div>
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                {CATEGORY_ICON[activeView] ?? <FolderIcon />}
                <h2 className="text-lg font-bold text-gray-900">{activeView}</h2>
              </div>
              <p className="text-sm text-gray-500">
                {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="p-6">
              {docs === null ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : filteredDocs.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                    <FileDocIcon />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No documents in this folder</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
                  {filteredDocs.map((doc) => (
                    <div key={doc.id} className="flex flex-wrap items-center justify-between px-5 py-4 gap-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <FileDocIcon />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{doc.originalFilename} · {fmtDate(doc.uploadedAt)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <a
                          href={doc.viewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                        >
                          View
                        </a>
                        <a
                          href={doc.downloadUrl}
                          download
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
