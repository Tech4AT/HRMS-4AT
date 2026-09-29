'use client';

import { useState } from 'react';
import { BTN_OUTLINE, BTN_PRIMARY, EmptyRow, FolderIcon, SectionHeader, SELECT, TH } from './shared';

const COLS = ['Document title', 'Description', 'Acknowledgement required', 'Views/Acknowledge', 'Expiration date', 'Size', 'Last updated', 'Actions'];

/** Keka "Organization documents": folder rail + folder table + Add-document
 * side panel. There is no org-folder / acknowledgement backend yet, so the
 * rail and table are empty and write actions are disabled. */
export function OrganizationDocumentsTab() {
  const [panel, setPanel] = useState(false);
  const [ack, setAck] = useState(false);
  const [expiry, setExpiry] = useState(false);
  const [desc, setDesc] = useState(false);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Organization documents"
        subtitle="Documents in these folders can be uploaded/filled by admin. All these documents are available for viewing by all employees."
        actions={<button type="button" disabled className={BTN_PRIMARY}>+ Add document folder</button>}
      />
      <div className="flex gap-4 items-start">
        <aside className="w-64 shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm p-3 space-y-3">
          <input className={`${SELECT} w-full`} placeholder="Search folders" aria-label="Search folders" />
          {['Public folders', 'Private folders'].map((h) => (
            <div key={h}>
              <p className="px-1 text-[11px] font-semibold text-gray-400 uppercase">{h}</p>
              <p className="px-1 py-2 text-xs text-gray-400">No folders</p>
            </div>
          ))}
        </aside>
        <section className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 flex-wrap">
            <span className="w-9 h-9 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0">
              <FolderIcon className="w-4 h-4" />
            </span>
            <h3 className="text-base font-bold text-slate-900 mr-auto">No folder selected</h3>
            <button type="button" disabled className={BTN_OUTLINE}>Remind pending acknowledgements</button>
            <button type="button" onClick={() => setPanel(true)} className={BTN_PRIMARY}>+ Add document</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 w-8"><input type="checkbox" disabled aria-label="Select all" /></th>
                  {COLS.map((c) => <th key={c} className={TH}>{c}</th>)}
                </tr>
              </thead>
            </table>
            <EmptyRow>No documents</EmptyRow>
          </div>
        </section>
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setPanel(false)}>
          <div
            className="w-full max-w-md h-full bg-white shadow-xl flex flex-col"
            role="dialog"
            aria-label="Add new organization document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-bold text-slate-900">Add new organization document</h3>
              <button type="button" onClick={() => setPanel(false)} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Document name
                <input className={`${SELECT} w-full mt-1`} />
              </label>
              {desc ? (
                <label className="block text-sm font-medium text-slate-700">
                  Description
                  <textarea rows={3} className={`${SELECT} w-full mt-1`} />
                </label>
              ) : (
                <button type="button" onClick={() => setDesc(true)} className="text-sm text-purple-600 hover:underline">Add description</button>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" defaultChecked /> Allow employees to download the document
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Acknowledgement required from employees
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={expiry} onChange={(e) => setExpiry(e.target.checked)} /> Set expiration date for the document
              </label>
              {expiry && <input type="date" className={SELECT} aria-label="Expiration date" />}
              <button type="button" disabled className="text-sm text-purple-600 disabled:text-gray-400">Add Attachment</button>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setPanel(false)} className={BTN_OUTLINE}>Cancel</button>
              <button type="button" disabled title="Organization folders are not available yet" className={BTN_PRIMARY}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
