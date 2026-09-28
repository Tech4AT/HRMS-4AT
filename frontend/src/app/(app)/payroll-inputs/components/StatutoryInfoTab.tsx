'use client';

import { useState, useEffect } from 'react';

interface StatutoryInfo {
  id: string;
  employee_id: string;
  pan_number: string;
  pf_number: string;
  esi_number: string;
  lwf_applicable: boolean;
  professional_tax_state: string;
  professional_tax_exempt: boolean;
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

export default function StatutoryInfoTab({ employeeId }: Props) {
  const [info, setInfo] = useState<StatutoryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<StatutoryInfo[]>(
          `/api/payroll-inputs/statutory-info/?employee_id=${employeeId}`
        );
        setInfo(data[0] || null);
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
      {info && (
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-2">
          <p className="text-sm">
            PAN: <span className="font-medium">{info.pan_number}</span>
          </p>
          <p className="text-sm">
            PF (UAN): <span className="font-medium">{info.pf_number || '-'}</span>
          </p>
          <p className="text-sm">
            ESI: <span className="font-medium">{info.esi_number || '-'}</span>
          </p>
          <p className="text-sm">
            LWF Applicable: <span className="font-medium">{info.lwf_applicable ? 'Yes' : 'No'}</span>
          </p>
          {info.professional_tax_state && (
            <p className="text-sm">
              Professional Tax State: <span className="font-medium">{info.professional_tax_state}</span>
            </p>
          )}
          {info.professional_tax_exempt && (
            <p className="text-sm text-blue-600">✓ Professional Tax Exempt</p>
          )}
        </div>
      )}
      {!info && <div className="text-gray-500 text-center py-8">No statutory information</div>}
    </div>
  );
}
