'use client';

import { useCallback, useEffect, useState } from 'react';
import { PermissionGate } from '@/components/PermissionGate';
import { useAuth } from '@/lib/auth/useAuth';
import { Asset, AssetStatus, AssetsApiError, assignAsset, listAssets } from '@/lib/api/assets';
import { orgApi, OrgEmployee } from '@/lib/api/org';

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
        <h1 className="text-xl font-semibold">Assets</h1>
        <p className="mt-1 text-sm text-gray-500">Company laptop inventory{total ? ` — ${total} total` : ''}</p>

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
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canWrite ? 9 : 8} className="px-4 py-6 text-center text-gray-500">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={canWrite ? 9 : 8} className="px-4 py-6 text-center text-gray-500">No assets found.</td></tr>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
