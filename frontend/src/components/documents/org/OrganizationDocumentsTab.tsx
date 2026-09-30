'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import {
  AUDIENCE_OPTIONS,
  audienceLabel,
  documentsApi,
  DocumentsApiError,
  orgDocAckRequired,
  orgDocTitle,
  validateDocumentFile,
  type AcknowledgementStatus,
  type DocumentFolder,
  type FolderVisibility,
  type OrgDocAudience,
  type OrgDocument,
} from '@/lib/api/documents';
import { BTN_OUTLINE, BTN_PRIMARY, EmptyRow, FolderIcon, SectionHeader, SELECT, TH } from './shared';
import { PendingAcknowledgements } from './PendingAcknowledgements';

const COLS = ['Document title', 'Description', 'Acknowledgement required', 'Views/Acknowledge', 'Expiration date', 'Size', 'Last updated', 'Actions'];

function fmtSize(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function docSize(d: OrgDocument): number | null {
  return d.fileSize ?? d.size ?? null;
}

function docUpdated(d: OrgDocument): string | null {
  return d.uploadedAt ?? d.uploaded_at ?? null;
}

function docExpiry(d: OrgDocument): string | null {
  return d.expiryDate ?? d.expiry_date ?? null;
}

/** Small inline pencil glyph for the HR folder edit control (kept local so
 * the shared rail module stays untouched). */
function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

/** Keka "Organization documents": folder rail + folder table + Add-document
 * side panel, wired to Parcel A (audience + acknowledgement). The folder
 * rail stays empty until org-folders land; the table lists real documents
 * and the VIEWS / ACKNOWLEDGE column shows live "N of M Acknowledged"
 * from GET acknowledgements. Admin controls render for HR only. */
export function OrganizationDocumentsTab() {
  const { user } = useAuth();
  const isHr = !!user && (user.scope.kind === 'org' || /hr|admin/i.test(user.role ?? ''));

  const [docs, setDocs] = useState<OrgDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AcknowledgementStatus>>({});
  const [statusMissing, setStatusMissing] = useState(false);
  const [openStatusId, setOpenStatusId] = useState<string | number | null>(null);
  const [remindNote, setRemindNote] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);

  // Folder rail: null selection = "All documents" (orgList); otherwise the
  // selected folder's documents. Folders load once; docs reload on selection.
  const [folders, setFolders] = useState<DocumentFolder[] | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | number | null>(null);
  const [folderForm, setFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderVis, setNewFolderVis] = useState<FolderVisibility>('public');
  const [folderBusy, setFolderBusy] = useState(false);
  // Inline folder edit (HR): rename + change public/private without a modal.
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderVis, setEditFolderVis] = useState<FolderVisibility>('public');
  const [folderError, setFolderError] = useState<string | null>(null);

  const [panel, setPanel] = useState(false);
  const [name, setName] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [audience, setAudience] = useState<OrgDocAudience>('all_employees');
  const [ack, setAck] = useState(false);
  const [expiryOn, setExpiryOn] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      setLoadError(null);
      setDocs(
        selectedFolderId === null
          ? await documentsApi.orgList()
          : await documentsApi.folderDocuments(selectedFolderId),
      );
    } catch (e) {
      setDocs([]);
      setLoadError(e instanceof DocumentsApiError ? e.message : 'Failed to load documents');
    }
  }, [selectedFolderId]);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await documentsApi.folders());
    } catch {
      setFolders([]);
    }
  }, []);

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setFolderBusy(true);
    try {
      await documentsApi.folderCreate({ name: newFolderName.trim(), visibility: newFolderVis });
      setNewFolderName('');
      setNewFolderVis('public');
      setFolderForm(false);
      await loadFolders();
    } finally {
      setFolderBusy(false);
    }
  };

  const startEditFolder = (f: DocumentFolder) => {
    setFolderError(null);
    setEditingFolderId(String(f.id));
    setEditFolderName(f.name);
    setEditFolderVis(f.visibility);
  };

  /** Save the inline rename / visibility change and refresh the rail. */
  const saveFolder = async () => {
    if (editingFolderId === null || !editFolderName.trim()) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      await documentsApi.folderUpdate(editingFolderId, {
        name: editFolderName.trim(),
        visibility: editFolderVis,
      });
      setEditingFolderId(null);
      await loadFolders();
    } catch (e) {
      setFolderError(e instanceof DocumentsApiError ? e.message : 'Failed to update folder');
    } finally {
      setFolderBusy(false);
    }
  };

  const loadStatuses = useCallback(async (list: OrgDocument[]) => {
    const targets = list.filter(orgDocAckRequired);
    if (targets.length === 0) return;
    const next: Record<string, AcknowledgementStatus> = {};
    let missing = false;
    await Promise.all(
      targets.map(async (d) => {
        try {
          next[String(d.id)] = await documentsApi.acknowledgements(d.id);
        } catch (e) {
          if (e instanceof DocumentsApiError && (e.status === 404 || e.status === 501)) missing = true;
        }
      }),
    );
    setStatuses(next);
    setStatusMissing(missing);
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (docs) void loadStatuses(docs);
  }, [docs, loadStatuses]);

  /** "Remind pending acknowledgements" notifies every in-scope employee still
   * pending on each ack-required document in the current view, then refreshes
   * the status counts. */
  const remind = async () => {
    if (!docs) return;
    setReminding(true);
    setRemindNote(null);
    try {
      const targets = docs.filter(orgDocAckRequired);
      let notified = 0;
      for (const d of targets) {
        try {
          const r = await documentsApi.remindAcknowledgement(d.id);
          notified += r.notified;
        } catch {
          /* skip a doc that can't be reminded (e.g. no longer ack-required) */
        }
      }
      await loadStatuses(docs);
      setRemindNote(
        targets.length === 0
          ? 'No acknowledgement-required documents here.'
          : `Reminder sent to ${notified} employee${notified === 1 ? '' : 's'}.`,
      );
    } finally {
      setReminding(false);
    }
  };

  const resetPanel = () => {
    setPanel(false);
    setName('');
    setDescOpen(false);
    setDesc('');
    setAudience('all_employees');
    setAck(false);
    setExpiryOn(false);
    setExpiry('');
    setFile(null);
    setFormError(null);
  };

  const create = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Document name is required.');
      return;
    }
    if (!file) {
      setFormError('Attach a file for the document.');
      return;
    }
    const fileError = validateDocumentFile(file);
    if (fileError) {
      setFormError(fileError);
      return;
    }
    setSaving(true);
    try {
      await documentsApi.orgCreate({
        file,
        title: name.trim(),
        description: descOpen && desc.trim() ? desc.trim() : undefined,
        audience,
        acknowledgementRequired: ack,
        expiryDate: expiryOn && expiry ? expiry : null,
        folderId: selectedFolderId ?? undefined,
      });
      resetPanel();
      await Promise.all([loadDocs(), loadFolders()]);
    } catch (e) {
      setFormError(e instanceof DocumentsApiError ? e.message : 'Failed to add document');
    } finally {
      setSaving(false);
    }
  };

  const openStatus = openStatusId !== null ? docs?.find((d) => String(d.id) === String(openStatusId)) ?? null : null;
  const openStatusData = openStatusId !== null ? statuses[String(openStatusId)] : undefined;
  const selectedFolder = folders?.find((f) => String(f.id) === String(selectedFolderId)) ?? null;
  const publicFolders = (folders ?? []).filter((f) => f.visibility === 'public');
  const privateFolders = (folders ?? []).filter((f) => f.visibility === 'private');

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Organization documents"
        subtitle="Documents in these folders can be uploaded/filled by admin. All these documents are available for viewing by all employees."
        actions={isHr ? <button type="button" onClick={() => setFolderForm((v) => !v)} className={BTN_PRIMARY}>+ Add document folder</button> : undefined}
      />

      {/* Employee-side acknowledgement inbox (all roles). */}
      <PendingAcknowledgements onChanged={loadDocs} />

      <div className="flex gap-4 items-start">
        <aside className="w-64 shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm p-3 space-y-3">
          {isHr && folderForm && (
            <div className="rounded-lg border border-gray-200 p-2 space-y-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className={`${SELECT} w-full`}
                placeholder="Folder name"
                aria-label="New folder name"
              />
              <select value={newFolderVis} onChange={(e) => setNewFolderVis(e.target.value as FolderVisibility)} className={`${SELECT} w-full`} aria-label="Folder visibility">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={createFolder} disabled={folderBusy || !newFolderName.trim()} className={`${BTN_PRIMARY} flex-1`}>
                  {folderBusy ? 'Adding…' : 'Add folder'}
                </button>
                <button type="button" onClick={() => setFolderForm(false)} className={BTN_OUTLINE}>Cancel</button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`w-full text-left px-2 py-1.5 rounded-lg text-sm ${selectedFolderId === null ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-gray-50'}`}
          >
            All documents
          </button>
          {[
            { h: 'Public folders', list: publicFolders },
            { h: 'Private folders', list: privateFolders },
          ].map(({ h, list }) => (
            <div key={h}>
              <p className="px-1 text-[11px] font-semibold text-gray-400 uppercase">{h}</p>
              {folders === null ? (
                <p className="px-1 py-2 text-xs text-gray-400">Loading…</p>
              ) : list.length === 0 ? (
                <p className="px-1 py-2 text-xs text-gray-400">No folders</p>
              ) : (
                list.map((f) => {
                  if (editingFolderId === String(f.id)) {
                    // Inline rename / visibility editor (HR only) — no modal.
                    return (
                      <div key={f.id} className="rounded-lg border border-purple-200 p-2 space-y-2">
                        <input
                          value={editFolderName}
                          onChange={(e) => setEditFolderName(e.target.value)}
                          className={`${SELECT} w-full`}
                          placeholder="Folder name"
                          aria-label={`Rename folder ${f.name}`}
                        />
                        <select
                          value={editFolderVis}
                          onChange={(e) => setEditFolderVis(e.target.value as FolderVisibility)}
                          className={`${SELECT} w-full`}
                          aria-label={`Visibility of folder ${f.name}`}
                        >
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                        {folderError && <p className="text-[11px] text-red-600">{folderError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveFolder}
                            disabled={folderBusy || !editFolderName.trim()}
                            className={`${BTN_PRIMARY} flex-1`}
                          >
                            {folderBusy ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditingFolderId(null)} className={BTN_OUTLINE}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={f.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedFolderId(f.id)}
                        className={`min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${String(selectedFolderId) === String(f.id) ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-gray-50'}`}
                      >
                        <FolderIcon className="w-4 h-4 shrink-0 text-gray-400" />
                        <span className="truncate mr-auto">{f.name}</span>
                        <span className="text-[11px] text-gray-400">{f.documentCount ?? 0}</span>
                      </button>
                      {isHr && (
                        <button
                          type="button"
                          onClick={() => startEditFolder(f)}
                          aria-label={`Edit folder ${f.name}`}
                          title="Rename or change visibility"
                          className="p-1 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50 shrink-0"
                        >
                          <PencilIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </aside>
        <section className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 flex-wrap">
            <span className="w-9 h-9 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0">
              <FolderIcon className="w-4 h-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900 mr-auto">{selectedFolder ? selectedFolder.name : 'All documents'}</h3>
            {isHr && (
              <>
                <button type="button" onClick={remind} disabled={reminding || !docs} className={BTN_OUTLINE}>
                  {reminding ? 'Refreshing…' : 'Remind pending acknowledgements'}
                </button>
                <button type="button" onClick={() => setPanel(true)} className={BTN_PRIMARY}>+ Add document</button>
              </>
            )}
          </div>
          {remindNote && <p className="px-5 pt-3 text-xs text-gray-500">{remindNote}</p>}
          {statusMissing && (
            <p className="px-5 pt-3 text-xs text-gray-500">Acknowledgement counts are unavailable until the acknowledgement service lands.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 w-8"><input type="checkbox" disabled aria-label="Select all" /></th>
                  {COLS.map((c) => <th key={c} className={TH}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {(docs ?? []).map((d) => {
                  const required = orgDocAckRequired(d);
                  const st = statuses[String(d.id)];
                  return (
                    <tr key={d.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-5 py-3"><input type="checkbox" disabled aria-label={`Select ${orgDocTitle(d)}`} /></td>
                      <td className="px-5 py-3 text-sm font-medium text-slate-900">
                        {orgDocTitle(d)}
                        <span className="block text-[11px] font-normal text-gray-400">{audienceLabel(d.audience)}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500 max-w-56 truncate">{d.description || '—'}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{required ? 'Yes' : 'No'}</td>
                      <td className="px-5 py-3 text-sm">
                        {required ? (
                          st ? (
                            isHr ? (
                              <button
                                type="button"
                                onClick={() => setOpenStatusId(d.id)}
                                className="font-semibold text-purple-600 hover:underline"
                                title="View who acknowledged / pending"
                              >
                                {st.acknowledged} of {st.total} Acknowledged
                              </button>
                            ) : (
                              <span className="font-semibold text-slate-700">{st.acknowledged} of {st.total} Acknowledged</span>
                            )
                          ) : (
                            <span className="text-gray-400">—</span>
                          )
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{fmtDate(docExpiry(d))}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{fmtSize(docSize(d))}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{fmtDate(docUpdated(d))}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {docs === null ? (
              <p className="px-5 py-10 text-center text-sm text-gray-500">Loading…</p>
            ) : docs.length === 0 ? (
              <EmptyRow>{loadError ?? 'No documents'}</EmptyRow>
            ) : null}
          </div>
        </section>
      </div>

      {/* HR-only scope-based status detail: who acknowledged / pending. */}
      {isHr && openStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpenStatusId(null)}>
          <div
            className="w-full max-w-lg max-h-[80vh] bg-white rounded-2xl shadow-xl flex flex-col"
            role="dialog"
            aria-label={`Acknowledgement status for ${orgDocTitle(openStatus)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">{orgDocTitle(openStatus)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {openStatusData ? `${openStatusData.acknowledged} of ${openStatusData.total} acknowledged` : 'Loading status…'} · scoped to your view
                </p>
              </div>
              <button type="button" onClick={() => setOpenStatusId(null)} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!openStatusData ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : openStatusData.items.length === 0 ? (
                <p className="text-sm text-gray-500">No employees in scope.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {openStatusData.items.map((it) => (
                    <li key={it.employee} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{it.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {it.acknowledged ? `Acknowledged ${fmtDate(it.acknowledgedAt ?? it.acknowledged_at ?? undefined)}` : 'Pending'}
                        </p>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${it.acknowledged ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {it.acknowledged ? 'Acknowledged' : 'Pending'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button type="button" onClick={() => setOpenStatusId(null)} className={BTN_OUTLINE}>Close</button>
            </div>
          </div>
        </div>
      )}

      {isHr && panel && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={resetPanel}>
          <div
            className="w-full max-w-md h-full bg-white shadow-xl flex flex-col"
            role="dialog"
            aria-label="Add new organization document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-bold text-slate-900">Add new organization document</h3>
              <button type="button" onClick={resetPanel} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Document name
                <input value={name} onChange={(e) => setName(e.target.value)} className={`${SELECT} w-full mt-1`} />
              </label>
              {descOpen ? (
                <label className="block text-sm font-medium text-slate-700">
                  Description
                  <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} className={`${SELECT} w-full mt-1`} />
                </label>
              ) : (
                <button type="button" onClick={() => setDescOpen(true)} className="text-sm text-purple-600 hover:underline">Add description</button>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Audience
                <select value={audience} onChange={(e) => setAudience(e.target.value as OrgDocAudience)} className={`${SELECT} w-full mt-1`} aria-label="Audience">
                  {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" defaultChecked /> Allow employees to download the document
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Acknowledgement required from employees
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={expiryOn} onChange={(e) => setExpiryOn(e.target.checked)} /> Set expiration date for the document
              </label>
              {expiryOn && <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={SELECT} aria-label="Expiration date" />}
              <label className="block text-sm font-medium text-slate-700">
                Attachment
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-purple-600 file:bg-purple-50 file:border file:border-purple-200 file:rounded-lg hover:file:bg-purple-100"
                />
              </label>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={resetPanel} className={BTN_OUTLINE}>Cancel</button>
              <button type="button" onClick={create} disabled={saving} className={BTN_PRIMARY}>
                {saving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
