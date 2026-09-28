'use client';

import { useState, useEffect } from 'react';

interface Benefit {
  id: string;
  employee_id: string;
  benefit_type: string;
  name: string;
  provider: string;
  employee_contribution: number;
  employer_contribution: number;
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

export default function BenefitsTab({ employeeId }: Props) {
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<Benefit[]>(`/api/payroll-inputs/benefits/?employee_id=${employeeId}`);
        setBenefits(data);
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
      {benefits.length === 0 && <div className="text-gray-500 text-center py-8">No benefits</div>}
      {benefits.map((b) => (
        <div key={b.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h4 className="font-semibold text-slate-900">{b.name}</h4>
              <p className="text-sm text-gray-600 capitalize">{b.benefit_type.replace('_', ' ')}</p>
              {b.provider && <p className="text-sm text-gray-600">Provider: {b.provider}</p>}
            </div>
            <span
              className={`px-2 py-1 text-xs font-semibold rounded ${
                b.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'
              }`}
            >
              {b.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="text-sm text-gray-600">Employee Contribution: ₹{b.employee_contribution.toLocaleString()}</p>
          <p className="text-sm text-gray-600">Employer Contribution: ₹{b.employer_contribution.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
