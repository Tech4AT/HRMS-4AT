import { useEffect, useState } from 'react';

import {
  documentTemplatesApi,
  type DocumentTemplate,
  type TemplateFolder,
} from '@/lib/api/documentTemplates';
import { onboardingApi, type OfferLetterTemplate } from '@/lib/api/onboarding';
import { BTN_OUTLINE, BTN_PRIMARY, EmptyRow, SectionHeader, SELECT, TH } from './shared';
import { DocumentUploadModal } from '../DocumentUploadModal';
import { TemplateWizard, type WizardTarget } from './TemplateWizard';

const COLS = ['Document name', 'Folder', 'Workflow enabled', 'Action type', 'Last used', 'Actions'];
const PAGE_SIZE = 50;
const OFFER_FOLDER = 'Offer Letters';

type RowBase = {
  key: string;
  name: string;
  folderName: string | null;
  folderId: string;
  workflow: boolean;
  lastUsed: string | null;
};
type Row =
  | (RowBase & { kind: 'document'; template: DocumentTemplate })
  | (RowBase & { kind: 'offer'; template: OfferLetterTemplate });

/** Keka "Document templates" screen. General templates come from the
 * document_templates engine; offer letter templates (onboarding app) are
 * listed alongside them and edited through the same 3-step wizard. */
export function DocumentTemplatesTab() {
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null);
  const [offers, setOffers] = useState<OfferLetterTemplate[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardTarget | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoadError(null);
    try {
      const [list, folderList, offerList] = await Promise.all([
        documentTemplatesApi.list(),
        documentTemplatesApi.folders(),
        onboardingApi.getOfferLetterTemplates().catch(() => [] as OfferLetterTemplate[]),
      ]);
      setTemplates(list);
      setFolders(folderList);
      setOffers(offerList);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load templates');
      setTemplates([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows: Row[] = [
    ...(templates ?? []).map(
      (t): Row => ({
        kind: 'document',
        key: `d${t.id}`,
        name: t.name,
        folderName: t.folderName,
        folderId: String(t.folder ?? ''),
        workflow: t.workflowEnabled,
        lastUsed: t.lastUsedAt,
        template: t,
      }),
    ),
    ...offers.map(
      (o): Row => ({
        kind: 'offer',
        key: `o${o.id}`,
        name: o.name,
        folderName: OFFER_FOLDER,
        folderId: 'offer',
        workflow: false,
        lastUsed: null,
        template: o,
      }),
    ),
  ];

  const filtered = rows.filter((r) => {
    if (actionFilter && actionFilter !== 'document_generation') return false;
    if (statusFilter === 'workflow' && !r.workflow) return false;
    if (statusFilter === 'no-workflow' && r.workflow) return false;
    if (folderFilter && r.folderId !== folderFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const visible = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const remove = async (r: Row) => {
    if (!confirm(`Delete template "${r.name}"?`)) return;
    setNotice(null);
    try {
      if (r.kind === 'offer') await onboardingApi.deactivateOfferLetterTemplate(r.template.id);
      else await documentTemplatesApi.remove(r.template.id);
      await load();
      setNotice(`Template "${r.name}" deleted.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Delete failed');
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
            <button type="button" onClick={() => setWizard({ kind: 'new' })} className={BTN_PRIMARY}>
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
      {wizard && (
        <TemplateWizard
          target={wizard}
          folders={folders}
          onClose={() => setWizard(null)}
          onSaved={(msg) => {
            setWizard(null);
            setNotice(msg);
            void load();
          }}
        />
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
          <option value="offer">{OFFER_FOLDER}</option>
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
            {visible.map((r) => (
              <tr key={r.key} className="border-b border-gray-100 last:border-0 h-16">
                <td className="px-5 py-3 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setWizard(
                        r.kind === 'offer'
                          ? { kind: 'offer', template: r.template }
                          : { kind: 'document', template: r.template },
                      )
                    }
                    className="text-purple-700 hover:underline text-left"
                  >
                    {r.name}
                  </button>
                  {r.kind === 'offer' && r.template.isDefault && (
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                      Default
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-slate-800">{r.folderName ?? '—'}</td>
                <td className="px-5 py-3 text-sm text-slate-800">{r.workflow ? 'Yes' : 'No'}</td>
                <td className="px-5 py-3 text-sm text-slate-800">📄 Document Generation</td>
                <td className="px-5 py-3 text-sm text-gray-500">
                  {r.lastUsed
                    ? new Date(r.lastUsed).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : 'Not Generated'}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  {r.kind === 'document' && (
                    <button
                      type="button"
                      disabled={generatingId === r.template.id}
                      onClick={() => generate(r.template)}
                      className={`${BTN_OUTLINE} mr-2`}
                    >
                      {generatingId === r.template.id ? 'Generating…' : 'Generate'}
                    </button>
                  )}
                  <button type="button" onClick={() => remove(r)} className="text-sm text-red-600 hover:underline">
                    Delete
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
        <div className="flex items-center justify-end gap-6 px-6 py-3 border-t border-gray-100 text-xs text-slate-700">
          <span>
            {filtered.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1} to {Math.min(curPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button type="button" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="disabled:opacity-30" aria-label="Previous page">‹</button>
          <span>Page {curPage} of {pageCount}</span>
          <button type="button" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)} className="disabled:opacity-30" aria-label="Next page">›</button>
        </div>
      </div>
    </div>
  );
}
