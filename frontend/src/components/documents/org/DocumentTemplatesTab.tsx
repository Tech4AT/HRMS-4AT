import { BTN_PRIMARY, EmptyRow, SectionHeader, SELECT, TH } from './shared';

const COLS = ['Document name', 'Folder', 'Workflow enabled', 'Action type', 'Last used', 'Actions'];

/** Keka "Document templates" screen. No templates backend exists yet, so the
 * chrome renders with an empty table and disabled actions. */
export function DocumentTemplatesTab() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Document templates"
        subtitle="Generate agreements, employee letters or compliance forms and send for signature/upload/acknowledgement."
        actions={
          <button type="button" disabled className={BTN_PRIMARY}>
            + Create template ▾
          </button>
        }
      />
      <div className="flex items-center gap-3 flex-wrap">
        <select disabled className={SELECT} aria-label="Action type"><option>Action Type</option></select>
        <select disabled className={SELECT} aria-label="Template status"><option>Template Status</option></select>
        <select disabled className={SELECT} aria-label="Folder"><option>Folder</option></select>
        <input disabled placeholder="Search" className={`${SELECT} ml-auto w-56`} aria-label="Search templates" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{COLS.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
          </thead>
        </table>
        <EmptyRow>No document templates</EmptyRow>
      </div>
    </div>
  );
}
