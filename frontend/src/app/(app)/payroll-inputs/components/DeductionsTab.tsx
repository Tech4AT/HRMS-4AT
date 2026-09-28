'use client';

import { useState, useEffect } from 'react';

interface Deduction {
  id: string;
  employee_id: string;
  deduction_type: string;
  name: string;
  total_amount: number;
  installment_amount: number;
  installments_remaining: number;
  is_active: boolean;
}

interface Props {
  employeeId: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) throw new Error(body?.error?.message || 'Request failed');
  return body.data as T;
}

export default function DeductionsTab({ employeeId }: Props) {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<Deduction[]>(`/api/payroll-inputs/deductions/?employee_id=${employeeId}`);
        setDeductions(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [employeeId]);

  if (!employeeId) return <div className="text-gray-500">Select an employee</div>;
  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}
      {deductions.length === 0 && <div className="text-gray-500 text-center py-8">No deductions</div>}
      {deductions.map((d) => (
        <div key={d.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-semibold text-slate-900">{d.name}</h4>
              <p className="text-sm text-gray-600 mt-1 capitalize">{d.deduction_type}</p>
              <p className="text-sm text-gray-600">
                Total: ₹{d.total_amount.toLocaleString()} | Monthly: ₹{d.installment_amount.toLocaleString()}
              </p>
              <p className="text-sm text-gray-600">Remaining: {d.installments_remaining} installments</p>
            </div>
            <span
              className={`px-2 py-1 text-xs font-semibold rounded ${
                d.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'
              }`}
            >
              {d.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
