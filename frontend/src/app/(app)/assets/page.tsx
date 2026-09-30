'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionGate } from '@/components/PermissionGate';
import { useAuth } from '@/lib/auth/useAuth';
import {
  Asset,
  AssetInput,
  AssetStatus,
  AssetsApiError,
  assignAsset,
  createAsset,
  deleteAsset,
  importAssets,
  listAssets,
  updateAsset,
} from '@/lib/api/assets';
import { orgApi, OrgEmployee } from '@/lib/api/org';

const EMPTY_FORM: AssetInput = {
  assetTag: '', brand: '', serial: '', processor: '', ram: '',
  dateOfAllotment: '', dateOfRecover: '', hasBag: false, previouslyUsed: '',
};

function fullName(e: OrgEmployee) {
  return `${e.first_name} ${e.last_name}`.trim() || e.work_email;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  assigned: 'Assigned',
  available: 'Available',
  recovered: 'Recovered',
};

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('assets.write');

  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [assigned, setAssigned] = useState<'true' | 'false' | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);
  const [assigning, setAssigning] = useState<number | null>(null);

  // Create/edit modal + file upload.
  const [editing, setEditing] = useState<Asset | 'new' | null>(null);
  const [form, setForm] = useState<AssetInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openNew = () => { setForm(EMPTY_FORM); setFormError(null); setEditing('new'); };
  const openEdit = (a: Asset) => {
    setForm({
      assetTag: a.assetTag, category: a.category, brand: a.brand, serial: a.serial,
      processor: a.processor, ram: a.ram, dateOfAllotment: a.dateOfAllotment ?? '',
      dateOfRecover: a.dateOfRecover ?? '', hasBag: a.hasBag, previouslyUsed: a.previouslyUsed,
    });
    setFormError(null);
    setEditing(a);
  };

  const saveForm = async () => {
    if (!form.assetTag.trim()) { setFormError('Asset tag is required.'); return; }
    setSaving(true);
    setFormError(null);
    try {
      const payload: AssetInput = { ...form, dateOfAllotment: form.dateOfAllotment || null, dateOfRecover: form.dateOfRecover || null };
      if (editing === 'new') await createAsset(payload);
      else if (editing) await updateAsset(editing.id, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(e instanceof AssetsApiError ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (a: Asset) => {
    if (!confirm(`Delete asset ${a.assetTag}? This cannot be undone.`)) return;
    try {
      await deleteAsset(a.id);
      await load();
    } catch (e) {
      alert(e instanceof AssetsApiError ? e.message : 'Failed to delete');
    }
  };

  const doImport = async (file: File) => {
    setImporting(true);
    setNotice(null);
    try {
      const r = await importAssets(file);
      setNotice(`Imported: ${r.created} added, ${r.updated} updated (${r.total} total, ${r.assigned} assigned, ${r.unmatched} names matched no employee).`);
      await load();
    } catch (e) {
      alert(e instanceof AssetsApiError ? e.message : 'Failed to import file');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, dir] = await Promise.all([
        listAssets({ search: search || undefined, status: status || undefined, assigned: assigned || undefined, page, pageSize: 20 }),
        canWrite ? orgApi.listDirectory().catch(() => [] as OrgEmployee[]) : Promise.resolve([] as OrgEmployee[]),
      ]);
      setItems(result.items);
      setTotal(result.total);
      setDirectory(dir);
    } catch (e) {
      setError(e instanceof AssetsApiError ? e.message : 'Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, [search, status, assigned, page, canWrite]);

  useEffect(() => {
    load();
  }, [load]);

  const doAssign = async (id: number, assignedTo: number | null) => {
    setAssigning(id);
    try {
      await assignAsset(id, assignedTo);
      await load();
    } catch (e) {
      alert(e instanceof AssetsApiError ? e.message : 'Failed to update assignment');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <PermissionGate
      permission="assets.read"
      fallback={<div className="p-6 text-sm text-gray-500">You don&apos;t have access to the asset inventory.</div>}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Assets</h1>
            <p className="mt-1 text-sm text-gray-500">Company laptop inventory{total ? ` — ${total} total` : ''}</p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xlsm"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); }}
              />
              <button
                disabled={importing}
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                title="Upload an updated asset tracker (CSV or xlsx) — matches rows by asset tag"
              >
                {importing ? 'Uploading…' : 'Upload file'}
              </button>
              <button
                onClick={openNew}
                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Add asset
              </button>
            </div>
          )}
        </div>

        {notice && <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{notice}</div>}

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search tag, brand, serial…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:border-indigo-500"
          />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as AssetStatus | ''); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="assigned">Assigned</option>
            <option value="available">Available</option>
            <option value="recovered">Recovered</option>
          </select>
          <select
            value={assigned}
            onChange={(e) => { setAssigned(e.target.value as 'true' | 'false' | ''); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Assigned + unassigned</option>
            <option value="true">Assigned only</option>
            <option value="false">Unassigned only</option>
          </select>
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-4 overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Asset tag</th>
                <th className="px-4 py-2">Brand</th>
                <th className="px-4 py-2">Serial</th>
                <th className="px-4 py-2">Processor</th>
                <th className="px-4 py-2">RAM</th>
                <th className="px-4 py-2">Assigned to</th>
                <th className="px-4 py-2">Allotted</th>
                <th className="px-4 py-2">Status</th>
                {canWrite && <th className="px-4 py-2">Assignment</th>}
                {canWrite && <th className="px-4 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canWrite ? 10 : 8} className="px-4 py-6 text-center text-gray-500">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={canWrite ? 10 : 8} className="px-4 py-6 text-center text-gray-500">No assets found.</td></tr>
              ) : (
                items.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium">{a.assetTag}</td>
                    <td className="px-4 py-2">{a.brand || '—'}</td>
                    <td className="px-4 py-2">{a.serial || '—'}</td>
                    <td className="px-4 py-2">{a.processor || '—'}</td>
                    <td className="px-4 py-2">{a.ram || '—'}</td>
                    <td className="px-4 py-2">{a.assignedToName || '—'}</td>
                    <td className="px-4 py-2">{formatDate(a.dateOfAllotment)}</td>
                    <td className="px-4 py-2">{STATUS_LABEL[a.status]}</td>
                    {canWrite && (
                      <td className="px-4 py-2">
                        {a.assignedTo ? (
                          <button
                            disabled={assigning === a.id}
                            onClick={() => doAssign(a.id, null)}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Unassign
                          </button>
                        ) : (
                          <select
                            defaultValue=""
                            disabled={assigning === a.id}
                            onChange={(e) => { if (e.target.value) doAssign(a.id, Number(e.target.value)); }}
                            className="text-xs border border-gray-300 rounded px-2 py-1 max-w-40"
                          >
                            <option value="">Assign…</option>
                            {directory.map((e) => (
                              <option key={e.id} value={e.id}>{fullName(e)}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}
                    {canWrite && (
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => openEdit(a)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                        <button onClick={() => doDelete(a)} className="ml-3 text-xs text-red-600 hover:underline">Delete</button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {editing !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && setEditing(null)}>
            <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold">{editing === 'new' ? 'Add asset' : `Edit ${editing.assetTag}`}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  ['assetTag', 'Asset tag *', 'text'],
                  ['brand', 'Brand', 'text'],
                  ['serial', 'Serial', 'text'],
                  ['processor', 'Processor', 'text'],
                  ['ram', 'RAM', 'text'],
                  ['previouslyUsed', 'Previously used by', 'text'],
                  ['dateOfAllotment', 'Date allotted', 'date'],
                  ['dateOfRecover', 'Date recovered', 'date'],
                ] as const).map(([key, label, type]) => (
                  <label key={key} className="text-sm">
                    <span className="block text-gray-600">{label}</span>
                    <input
                      type={type}
                      value={(form[key] as string) ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                ))}
                <label className="text-sm flex items-center gap-2 mt-6">
                  <input type="checkbox" checked={!!form.hasBag} onChange={(e) => setForm((f) => ({ ...f, hasBag: e.target.checked }))} />
                  <span className="text-gray-600">Has bag</span>
                </label>
              </div>
              {formError && <div className="mt-3 text-sm text-red-600">{formError}</div>}
              <div className="mt-5 flex justify-end gap-2">
                <button disabled={saving} onClick={() => setEditing(null)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50">Cancel</button>
                <button disabled={saving} onClick={saveForm} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3 text-sm text-gray-600">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
          >
            Prev
          </button>
          <span>Page {page}</span>
          <button
            disabled={loading || items.length < 20}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </PermissionGate>
  );
}
