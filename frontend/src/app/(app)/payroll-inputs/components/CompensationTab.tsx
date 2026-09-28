'use client';

import { useState, useEffect } from 'react';

interface Compensation {
  id: string;
  employee_id: string;
  salary_structure_name: string;
  fixed_monthly_amount: number;
  is_contractor: boolean;
  contractor_rate_type: string;
  contractor_rate: number;
  effective_from: string;
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

export default function CompensationTab({ employeeId }: Props) {
  const [compensation, setCompensation] = useState<Compensation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<Compensation[]>(`/api/payroll-inputs/compensation/?employee_id=${employeeId}`);
        setCompensation(data[0] || null);
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
      {compensation && (
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-2">
          <p className="text-sm">
            Fixed Monthly: <span className="font-medium">₹{compensation.fixed_monthly_amount.toLocaleString()}</span>
          </p>
          {compensation.salary_structure_name && (
            <p className="text-sm">
              Structure: <span className="font-medium">{compensation.salary_structure_name}</span>
            </p>
          )}
          {compensation.is_contractor && (
            <>
              <p className="text-sm">
                Rate Type: <span className="font-medium">{compensation.contractor_rate_type}</span>
              </p>
              <p className="text-sm">
                Rate: <span className="font-medium">{compensation.contractor_rate}</span>
              </p>
            </>
          )}
          <p className="text-sm text-gray-600">Effective: {new Date(compensation.effective_from).toLocaleDateString()}</p>
        </div>
      )}
      {!compensation && <div className="text-gray-500 text-center py-8">No compensation data</div>}
    </div>
  );
}
