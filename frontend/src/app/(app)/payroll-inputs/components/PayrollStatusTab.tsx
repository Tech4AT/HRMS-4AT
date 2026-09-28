'use client';

import { useState, useEffect } from 'react';

interface PayrollStatus {
  id: string;
  employee_id: string;
  is_payroll_enabled: boolean;
  disabled_reason: string;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) throw new Error(body?.error?.message || 'Request failed');
  return body.data as T;
}

export default function PayrollStatusTab() {
  const [statuses, setStatuses] = useState<(PayrollStatus & { employee_name: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [statusData, empData] = await Promise.all([
          fetchJson<PayrollStatus[]>('/api/payroll-inputs/payroll-status/'),
          fetchJson<Employee[]>('/api/employees/'),
        ]);
        const empMap = Object.fromEntries(empData.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
        const merged = statusData.map((s) => ({
          ...s,
          employee_name: empMap[s.employee_id] || s.employee_id,
        }));
        setStatuses(merged);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleToggle = async (statusId: string, newStatus: boolean) => {
    try {
      const res = await fetch(`/api/payroll-inputs/payroll-status/${statusId}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_payroll_enabled: newStatus }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error?.message || 'Failed to update');
      setStatuses(statuses.map((s) => (s.id === statusId ? { ...s, is_payroll_enabled: newStatus } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
    }
  };

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-900">Employee Payroll Status</h3>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {showUpload ? 'Hide Upload' : '📤 Bulk Upload'}
        </button>
      </div>

      {showUpload && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-gray-600 mb-3">Upload Excel file with columns: employee_id, is_payroll_enabled, disabled_reason</p>
          <input type="file" accept=".xlsx,.xls,.csv" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          <button className="mt-2 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Upload</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-300 bg-gray-50">
              <th className="px-4 py-2 text-left">Employee</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Reason</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-2">{s.employee_name}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded ${
                      s.is_payroll_enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {s.is_payroll_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-600">{s.disabled_reason || '-'}</td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => handleToggle(s.id, !s.is_payroll_enabled)}
                    className={`px-2 py-1 text-xs rounded ${
                      s.is_payroll_enabled ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {s.is_payroll_enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
