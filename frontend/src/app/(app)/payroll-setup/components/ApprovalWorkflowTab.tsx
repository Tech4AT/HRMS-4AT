'use client';

import { useState, useEffect } from 'react';

interface PayGroup {
  id: string;
  name: string;
  legal_entity_name: string;
  pay_schedule_name: string;
  approver_id: string;
  maker_checker_enabled: boolean;
  approval_threshold_amount: number | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function ApprovalWorkflowTab() {
  const [payGroups, setPayGroups] = useState<PayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPayGroups = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<{ results: PayGroup[] }>('/api/payroll-setup/pay-groups/');
        setPayGroups(data.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pay groups');
      } finally {
        setLoading(false);
      }
    };

    loadPayGroups();
  }, []);

  if (loading) return <div className="text-gray-500">Loading pay groups...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {payGroups.length === 0 && <div className="text-gray-500 text-center py-8">No pay groups configured</div>}

      {payGroups.map((group) => (
        <div key={group.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="font-semibold text-slate-900">{group.name}</h4>
          <p className="text-sm text-gray-600 mt-2">
            Entity: <span className="font-medium">{group.legal_entity_name}</span>
          </p>
          <p className="text-sm text-gray-600">
            Pay Schedule: <span className="font-medium">{group.pay_schedule_name}</span>
          </p>
          <p className="text-sm text-gray-600">
            Approver ID: <span className="font-medium">{group.approver_id}</span>
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                group.maker_checker_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'
              }`}
            >
              {group.maker_checker_enabled ? 'Maker-Checker Enabled' : 'Maker-Checker Disabled'}
            </span>
            {group.approval_threshold_amount && (
              <span className="text-xs text-gray-600">Threshold: ₹{group.approval_threshold_amount.toLocaleString()}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
