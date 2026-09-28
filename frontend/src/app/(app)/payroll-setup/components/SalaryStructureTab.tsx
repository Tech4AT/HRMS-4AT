'use client';

import { useState, useEffect } from 'react';

interface SalaryStructure {
  id: string;
  name: string;
  min_salary: number;
  max_salary: number;
  legal_entity_name: string;
  is_active: boolean;
  components: any[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function SalaryStructureTab() {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStructures = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<{ results: SalaryStructure[] }>('/api/payroll-setup/salary-structures/');
        setStructures(data.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load salary structures');
      } finally {
        setLoading(false);
      }
    };

    loadStructures();
  }, []);

  if (loading) return <div className="text-gray-500">Loading salary structures...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {structures.length === 0 && (
        <div className="text-gray-500 text-center py-8">No salary structures configured</div>
      )}

      {structures.map((structure) => (
        <div key={structure.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="font-semibold text-slate-900">{structure.name}</h4>
          <p className="text-sm text-gray-600 mt-2">
            Entity: <span className="font-medium">{structure.legal_entity_name}</span>
          </p>
          <p className="text-sm text-gray-600">
            Salary Range: ₹{structure.min_salary.toLocaleString()} - ₹{structure.max_salary.toLocaleString()}
          </p>
          <p className="text-sm text-gray-600">
            Components: <span className="font-medium">{structure.components?.length || 0} items</span>
          </p>
          <p className="text-sm text-gray-600">
            Status: <span className={structure.is_active ? 'text-green-600' : 'text-gray-600'}>{structure.is_active ? 'Active' : 'Inactive'}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
