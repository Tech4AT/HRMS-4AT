'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, reachLabel, type Exception, type Page } from '@/lib/admin/api';
import { Badge, Button, ConfirmModal, Notice, Pager, errorText } from './ui';

const PAGE_SIZE = 20;

export function ExceptionsTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Exception> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Exception | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.listExceptions({ page, pageSize: PAGE_SIZE }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await adminApi.removeException(removing.id);
      setRemoving(null);
      await load();
    } catch (e) {
      setRemoveError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-600 max-w-2xl mb-4">
        Every personal exception across the organisation: a permission given to, or taken from, one person regardless of their role. Add one from a person&apos;s page in the People tab.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold">Permission</th>
                <th className="px-4 py-3 font-semibold">Effect</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.results.map((x) => (
                <tr key={x.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{x.userName}</p>
                    <p className="text-xs text-gray-500">{x.userEmail}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{x.permissionCode}</td>
                  <td className="px-4 py-3">
                    {x.isGranted ? <Badge tone="green">Allowed · {reachLabel(x.scopeTier).toLowerCase()}</Badge> : <Badge tone="red">Denied</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="danger" onClick={() => setRemoving(x)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {data.results.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    No personal exceptions. Everyone has exactly what their role gives them.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {removing && (
        <ConfirmModal
          title="Remove this exception?"
          body={
            <p>
              {removing.userName} goes back to whatever their role gives them for <span className="font-mono text-xs">{removing.permissionCode}</span>.
            </p>
          }
          confirmLabel="Remove"
          danger
          busy={busy}
          error={removeError}
          onConfirm={remove}
          onCancel={() => {
            setRemoving(null);
            setRemoveError(null);
          }}
        />
      )}
    </div>
  );
}
