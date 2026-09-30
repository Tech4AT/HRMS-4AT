import { useEffect, useState } from 'react';

import {
  documentTemplatesApi,
  type DocumentTemplate,
  type TemplateFolder,
} from '@/lib/api/documentTemplates';
import { BTN_OUTLINE, BTN_PRIMARY, EmptyRow, SectionHeader, SELECT, TH } from './shared';
import { DocumentUploadModal } from '../DocumentUploadModal';

const COLS = ['Document name', 'Folder', 'Workflow enabled', 'Action type', 'Last used', 'Actions'];

/** Keka "Document templates" screen, wired to the document_templates engine. */
export function DocumentTemplatesTab() {
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      const [list, folderList] = await Promise.all([
        documentTemplatesApi.list(),
        documentTemplatesApi.folders(),
      ]);
      setTemplates(list);
      setFolders(folderList);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load templates');
      setTemplates([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = (templates ?? []).filter((t) => {
    if (actionFilter && t.actionType !== actionFilter) return false;
    if (statusFilter === 'workflow' && !t.workflowEnabled) return false;
    if (statusFilter === 'no-workflow' && t.workflowEnabled) return false;
    if (folderFilter && String(t.folder ?? '') !== folderFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await documentTemplatesApi.create({ name });
      setNewName('');
      setCreating(false);
      await load();
      setNotice(`Template "${name}" created.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (t: DocumentTemplate) => {
    setGeneratingId(t.id);
    setNotice(null);
    try {
      const doc = await documentTemplatesApi.generate(t.id);
      const extra = doc.placeholders.length
        ? ` Placeholders (not yet merged — employee data pending): ${doc.placeholders.join(', ')}.`
        : '';
      setNotice(`Generated "${doc.name}".${extra}`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Document templates"
        subtitle="Generate agreements, employee letters or compliance forms and send for signature/upload/acknowledgement."
        actions={
          <>
            <button type="button" onClick={() => setUploadOpen(true)} className={BTN_OUTLINE}>
              ⭱ Upload
            </button>
            <button type="button" onClick={() => setCreating((v) => !v)} className={BTN_PRIMARY}>
              + Create template ▾
            </button>
          </>
        }
      />
      {uploadOpen && (
        <DocumentUploadModal
          title="Upload template"
          entityType="document_template"
          entityId={0}
          employeeId={0}
          onUploaded={() => {
            setUploadOpen(false);
            setNotice('Template file uploaded.');
            void load();
          }}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {creating && (
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-4 py-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Template name, e.g. Appointment Letter"
            className={`${SELECT} flex-1`}
            aria-label="New template name"
          />
          <button type="button" disabled={busy || !newName.trim()} onClick={create} className={BTN_PRIMARY}>
            Create
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className={SELECT} aria-label="Action type">
          <option value="">Action Type</option>
          <option value="document_generation">Document Generation</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT} aria-label="Template status">
          <option value="">Template Status</option>
          <option value="workflow">Workflow enabled</option>
          <option value="no-workflow">No workflow</option>
        </select>
        <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} className={SELECT} aria-label="Folder">
          <option value="">Folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className={`${SELECT} ml-auto w-56`}
          aria-label="Search templates"
        />
      </div>
      {notice && <p className="text-sm text-slate-600 bg-white rounded-xl border border-gray-200 px-4 py-2">{notice}</p>}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{COLS.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 last:border-0">
                <td className="px-5 py-3 text-sm font-medium text-slate-900">{t.name}</td>
                <td className="px-5 py-3 text-sm text-slate-600">{t.folderName ?? '—'}</td>
                <td className="px-5 py-3 text-sm text-slate-600">{t.workflowEnabled ? 'Yes' : 'No'}</td>
                <td className="px-5 py-3 text-sm text-slate-600">📄 {t.actionType === 'document_generation' ? 'Document Generation' : t.actionType}</td>
                <td className="px-5 py-3 text-sm text-slate-600">
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : 'Not Generated'}
                </td>
                <td className="px-5 py-3">
                  <button
                    type="button"
                    disabled={generatingId === t.id}
                    onClick={() => generate(t)}
                    className={BTN_OUTLINE}
                  >
                    {generatingId === t.id ? 'Generating…' : 'Generate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {templates === null && !loadError && <EmptyRow>Loading templates…</EmptyRow>}
        {templates !== null && filtered.length === 0 && (
          <EmptyRow>{loadError ?? 'No document templates'}</EmptyRow>
        )}
      </div>
    </div>
  );
}
