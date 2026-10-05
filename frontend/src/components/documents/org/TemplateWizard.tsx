'use client';

import { useEffect, useRef, useState } from 'react';
import {
  documentTemplatesApi,
  type DocumentTemplate,
  type TemplateFolder,
} from '@/lib/api/documentTemplates';
import { onboardingApi, OnboardingApiError, type OfferLetterTemplate } from '@/lib/api/onboarding';
import { insertIntoDocx, renderDocx } from '@/lib/docxEditor';
import { BTN_OUTLINE, BTN_PRIMARY, SELECT } from './shared';

export type WizardTarget =
  | { kind: 'new' }
  | { kind: 'document'; template: DocumentTemplate }
  | { kind: 'offer'; template: OfferLetterTemplate };

const STEPS = ['Setup', 'Compose', 'Finalize'] as const;

const PLACEHOLDER_GROUPS: { label: string; fields: { label: string; token: string }[] }[] = [
  {
    label: 'Employee Basic Info',
    fields: [
      { label: 'First Name', token: 'first_name' },
      { label: 'Last Name', token: 'last_name' },
      { label: 'Full Name', token: 'full_name' },
      { label: 'Employee Number', token: 'employee_code' },
    ],
  },
  {
    label: 'Employee Job Info',
    fields: [
      { label: 'Designation', token: 'designation' },
      { label: 'Department', token: 'department' },
      { label: 'Employment Type', token: 'employment_type' },
      { label: 'Joining Date', token: 'joining_date' },
      { label: 'Reporting Manager', token: 'reporting_manager' },
      { label: 'Probation Period (months)', token: 'probation_period_months' },
      { label: 'Notice Period (days)', token: 'notice_period_days' },
    ],
  },
  {
    label: 'Employee Salary Info',
    fields: [
      { label: 'Annual Package', token: 'package' },
      { label: 'Monthly Package', token: 'monthly_package' },
      { label: 'Bonus', token: 'bonus' },
      { label: 'Extra Allowance', token: 'extra_allowance' },
    ],
  },
  { label: 'Organization Info', fields: [{ label: 'Today', token: 'today' }] },
];

const FIELD = 'w-full text-sm bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-slate-800 focus:outline-none focus:border-purple-500';

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-gray-200 rounded-lg px-6 py-5 bg-white">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-purple-600' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

/** Keka-style 3-step "Document template" editor (Setup → Compose → Finalize),
 * used for both general document templates and offer letter templates. */
export function TemplateWizard({
  target,
  folders,
  onClose,
  onSaved,
}: {
  target: WizardTarget;
  folders: TemplateFolder[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const existingDoc = target.kind === 'document' ? target.template : null;
  const existingOffer = target.kind === 'offer' ? target.template : null;
  const isEdit = target.kind !== 'new';

  const [step, setStep] = useState(0);
  const [isOffer, setIsOffer] = useState(target.kind === 'offer');
  const [name, setName] = useState(existingDoc?.name ?? existingOffer?.name ?? '');
  const [heading, setHeading] = useState(existingOffer?.heading ?? 'Offer of Employment');
  const [workflow, setWorkflow] = useState(existingDoc?.workflowEnabled ?? false);
  const [body, setBody] = useState(existingDoc?.body ?? existingOffer?.body ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [mode, setMode] = useState<'web' | 'word'>(existingOffer?.sourceDocxName || existingDoc?.file ? 'word' : 'web');
  const [folder, setFolder] = useState<string>(existingDoc?.folder != null ? String(existingDoc.folder) : '');
  const [isDefault, setIsDefault] = useState(existingOffer?.isDefault ?? false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(PLACEHOLDER_GROUPS[0].label);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<{ index: number; offset: number } | null>(null);
  const [docxBuf, setDocxBuf] = useState<ArrayBuffer | null>(null);
  const [wordEdited, setWordEdited] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);
  const [wordError, setWordError] = useState<string | null>(null);

  const existingFileName = existingOffer?.sourceDocxName ?? (existingDoc?.file ? decodeURIComponent(existingDoc.file.split('/').pop() ?? 'template file') : null);
  const hasExistingFile = !!existingFileName && !removeFile;
  const usingWord = mode === 'word';
  const wordFileName = file?.name ?? (hasExistingFile ? existingFileName : null);

  const loadWord = async (source: File | Blob) => {
    setWordLoading(true);
    setWordError(null);
    try {
      setDocxBuf(await source.arrayBuffer());
      setWordEdited(false);
    } catch {
      setWordError('Could not read this Word file.');
      setDocxBuf(null);
    } finally {
      setWordLoading(false);
    }
  };

  // Existing template with a Word file: fetch it so it can be edited here.
  const existingUrl = existingOffer?.sourceDocxName
    ? `/api/onboarding/offer-letter-templates/${existingOffer.id}/file`
    : existingDoc?.file
      ? `/api/document-templates/${existingDoc.id}/file`
      : null;
  useEffect(() => {
    if (!existingUrl) return;
    let cancelled = false;
    (async () => {
      setWordLoading(true);
      try {
        const res = await fetch(existingUrl, { credentials: 'include' });
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        if (!cancelled) await loadWord(blob);
      } catch {
        if (!cancelled) {
          setWordError('Could not load the existing Word file for editing - upload it again to edit.');
          setWordLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render the .docx faithfully (read-only) in the editor and the finalize preview.
  useEffect(() => {
    const target = step === 1 ? wordRef.current : step === 2 ? previewRef.current : null;
    if (!docxBuf || !usingWord || !target) return;
    renderDocx(docxBuf, target).catch(() => setWordError('Could not display this Word file.'));
  }, [docxBuf, usingWord, step]);

  // Remember where the admin last clicked in the document (paragraph index + character offset).
  useEffect(() => {
    const onSel = () => {
      const root = wordRef.current;
      const sel = window.getSelection();
      if (!root || !sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const start = range.startContainer;
      const el = start.nodeType === 1 ? (start as Element) : start.parentElement;
      const p = el?.closest('p');
      if (!p || !root.contains(p)) return;
      const index = Array.from(root.querySelectorAll('article p')).indexOf(p);
      if (index < 0) return;
      const pre = document.createRange();
      pre.selectNodeContents(p);
      pre.setEnd(range.startContainer, range.startOffset);
      caretRef.current = { index, offset: pre.toString().length };
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const insertIntoWord = async (text: string) => {
    if (!docxBuf) return;
    try {
      const patched = await insertIntoDocx(docxBuf, caretRef.current, text);
      caretRef.current = null;
      setDocxBuf(patched);
      setWordEdited(true);
    } catch (e) {
      setWordError(e instanceof Error ? e.message : 'Could not insert the field.');
    }
  };

  const insert = (token: string) => {
    if (usingWord) {
      if (docxBuf) void insertIntoWord(`{{${token}}}`);
      return;
    }
    const el = editorRef.current;
    const text = `{{${token}}}`;
    if (!el) {
      setBody((b) => b + text);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const next = () => {
    setError(null);
    if (step === 0 && !name.trim()) {
      setError('Name is required.');
      return;
    }
    if (step === 1 && isOffer && !wordFileName && !body.trim()) {
      setError('Upload a Word (.docx) file or type the letter body.');
      return;
    }
    setStep((s) => s + 1);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let sendFile = usingWord ? file : null;
      if (usingWord && wordEdited && docxBuf) {
        sendFile = new File([docxBuf], file?.name ?? existingFileName ?? `${name.trim() || 'template'}.docx`, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }
      const sendBody = usingWord ? '' : body;
      if (isOffer) {
        const input = { name: name.trim(), heading, body: sendBody, isDefault };
        if (existingOffer) {
          await onboardingApi.updateOfferLetterTemplate(
            existingOffer.id,
            { ...input, removeSourceDocx: (removeFile || !usingWord) && !sendFile },
            sendFile,
          );
        } else {
          await onboardingApi.createOfferLetterTemplate(input, sendFile);
        }
      } else {
        const payload = {
          name: name.trim(),
          workflowEnabled: workflow,
          body: sendBody,
          folder: folder ? Number(folder) : null,
        };
        if (existingDoc) await documentTemplatesApi.update(existingDoc.id, payload, sendFile);
        else await documentTemplatesApi.create(payload, sendFile);
      }
      onSaved(`Template "${name.trim()}" saved.`);
    } catch (e) {
      setError(e instanceof OnboardingApiError || e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const q = search.trim().toLowerCase();
  const groups = PLACEHOLDER_GROUPS.map((g) => ({
    ...g,
    fields: g.fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.token.includes(q)),
  })).filter((g) => g.fields.length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center justify-between px-6 h-14 border-b border-gray-200 shrink-0">
        <h2 className="text-lg text-slate-900">Document template</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-2xl leading-none">
          ×
        </button>
      </div>
      <div className="relative flex items-center justify-center h-16 border-b border-gray-200 shadow-sm shrink-0">
        <ol className="flex items-center gap-16">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-xs font-medium uppercase text-slate-700">
              <span
                className={`w-8 h-8 rounded-full border flex items-center justify-center text-sm ${
                  i === step ? 'bg-purple-700 border-purple-700 text-white' : 'border-purple-600 text-purple-700'
                }`}
              >
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <div className="absolute right-6 flex items-center gap-2">
          <button type="button" onClick={step === 0 ? onClose : () => setStep(step - 1)} className={BTN_OUTLINE}>
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 2 ? (
            <button type="button" onClick={next} className={BTN_PRIMARY}>Continue</button>
          ) : (
            <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border-b border-red-200 px-6 py-2">{error}</p>}

      <div className="flex-1 overflow-y-auto bg-gray-50">
        {step === 0 && (
          <div className="max-w-xl mx-auto py-8 space-y-6 bg-white min-h-full px-1">
            <label className="block">
              <span className="block text-sm text-slate-800 mb-2">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Salary revision letter" className={FIELD} />
            </label>
            {!isEdit && (
              <Toggle
                checked={isOffer}
                onChange={setIsOffer}
                label="This is an offer letter template"
                hint="Offer letter templates can be picked per hire in the Add New Employee form."
              />
            )}
            {isOffer ? (
              <label className="block">
                <span className="block text-sm text-slate-800 mb-2">Letter heading</span>
                <input value={heading} onChange={(e) => setHeading(e.target.value)} className={FIELD} />
              </label>
            ) : (
              <Toggle
                checked={workflow}
                onChange={setWorkflow}
                label="Require document workflow"
                hint="Configure signatures, approvals & acknowledgments for this document."
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex bg-white min-h-full">
            <aside className="w-80 shrink-0 border-r border-gray-200 p-6 overflow-y-auto">
              <p className="text-base text-slate-800 mb-4">Placeholders fields</p>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields"
                className={`${FIELD} mb-4`}
                aria-label="Search fields"
              />
              <div className="bg-gray-100 text-[11px] font-semibold text-gray-600 uppercase px-4 py-3 rounded mb-2">Auto complete fields</div>
              {groups.map((g) => {
                const expanded = !!q || open === g.label;
                return (
                  <div key={g.label}>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded && !q ? null : g.label)}
                      className="w-full flex items-center gap-3 py-3 text-sm text-slate-800 text-left"
                    >
                      <span className="text-gray-400 text-xs">{expanded ? '▴' : '▾'}</span>
                      {g.label}
                    </button>
                    {expanded && (
                      <ul className="pb-2">
                        {g.fields.map((f) => (
                          <li key={f.token}>
                            <button
                              type="button"
                              title={`{{${f.token}}}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insert(f.token)}
                              disabled={usingWord && !docxBuf}
                              className="w-full flex items-center gap-3 pl-9 py-2 text-sm text-slate-700 hover:text-purple-700 text-left disabled:opacity-50"
                            >
                              <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                              {f.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </aside>
            <section className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-200">
                <div>
                  <h3 className="text-xl text-slate-900">{usingWord ? 'Word document' : 'Simple web editor'}</h3>
                  <p className="text-sm text-gray-500">
                    {usingWord
                      ? 'Upload a .docx with {{placeholders}} typed into the text — formatting and letterhead are kept.'
                      : 'Use the built-in web editor to compose your document'}
                  </p>
                </div>
                <div className="flex border border-gray-200 rounded overflow-hidden shrink-0">
                  {(['web', 'word'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`px-5 py-2.5 text-sm ${mode === m ? 'bg-purple-50 text-purple-700 border border-purple-400' : 'text-slate-700'}`}
                    >
                      {m === 'web' ? 'Web Editor' : 'MS Word'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 bg-gray-100 p-8">
                {usingWord ? (
                  <div className="max-w-3xl mx-auto space-y-4">
                  <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
                    {wordFileName && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-700 truncate flex-1">📄 {wordFileName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFile(null);
                            setRemoveFile(true);
                            setDocxBuf(null);
                            setWordEdited(false);
                          }}
                          className="text-red-600 text-xs font-semibold hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    <input
                      type="file"
                      accept=".docx"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setFile(f);
                        setRemoveFile(false);
                        setDocxBuf(null);
                        if (f) void loadWord(f);
                      }}
                      className="text-sm w-full"
                    />
                  </div>
                  {wordLoading && <p className="text-sm text-gray-500">Loading document...</p>}
                  {wordError && <p className="text-sm text-amber-700">{wordError}</p>}
                  {docxBuf && (
                    <p className="text-xs text-gray-500">
                      Click in the document where the field should go, then pick a field on the left.
                    </p>
                  )}
                  <div ref={wordRef} className="overflow-x-auto [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0" aria-label="Word document content" />
                  </div>
                ) : (
                  <textarea
                    ref={editorRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={'Dear {{first_name}} {{last_name}},\n\nWe are pleased to offer you...'}
                    className="block max-w-3xl w-full min-h-[60vh] mx-auto bg-white shadow-sm border border-gray-200 p-10 text-sm text-slate-800 focus:outline-none"
                    aria-label="Document body"
                  />
                )}
              </div>
            </section>
          </div>
        )}

        {step === 2 && (
          <div className="flex bg-white min-h-full">
            <section className="flex-1 min-w-0 bg-gray-100 p-8">
              <div className="max-w-3xl mx-auto bg-white shadow-sm border border-gray-200 p-10 min-h-[60vh] text-sm text-slate-800 whitespace-pre-wrap">
                {isOffer && <p className="text-center font-bold text-base mb-6">{heading}</p>}
                {usingWord ? (
                  docxBuf ? (
                    <div ref={previewRef} className="whitespace-normal overflow-x-auto [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0" />
                  ) : (
                    `📄 ${wordFileName ?? 'No file attached'}`
                  )
                ) : (
                  body || 'No content yet.'
                )}
              </div>
            </section>
            <aside className="w-[28rem] shrink-0 border-l border-gray-200 p-6 space-y-6">
              {isOffer ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  Use as the default offer letter template for new hires
                </label>
              ) : (
                <label className="block">
                  <span className="block text-sm text-slate-800 mb-2">Select folder to save the document</span>
                  <select value={folder} onChange={(e) => setFolder(e.target.value)} className={`${SELECT} w-full`} aria-label="Folder">
                    <option value="">Select folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
