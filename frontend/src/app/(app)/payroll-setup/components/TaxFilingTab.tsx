'use client';

import { useState, useEffect } from 'react';

interface TaxFilingConfig {
  id: string;
  legal_entity_name: string;
  filing_frequency: 'quarterly' | 'half_yearly' | 'annual';
  state_tax_id: string;
  federal_tax_id: string;
  effective_from: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function TaxFilingTab() {
  const [taxConfigs, setTaxConfigs] = useState<TaxFilingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTaxConfigs = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<{ results: TaxFilingConfig[] }>('/api/payroll-setup/tax-filing-configs/');
        setTaxConfigs(data.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tax filing configurations');
      } finally {
        setLoading(false);
      }
    };

    loadTaxConfigs();
  }, []);

  if (loading) return <div className="text-gray-500">Loading tax filing configurations...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {taxConfigs.length === 0 && (
        <div className="text-gray-500 text-center py-8">No tax filing configurations</div>
      )}

      {taxConfigs.map((config) => (
        <div key={config.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="font-semibold text-slate-900">{config.legal_entity_name}</h4>
          <p className="text-sm text-gray-600 mt-2">
            Filing Frequency: <span className="font-medium">{config.filing_frequency}</span>
          </p>
          <p className="text-sm text-gray-600">
            Federal Tax ID: <span className="font-medium">{config.federal_tax_id || '-'}</span>
          </p>
          <p className="text-sm text-gray-600">
            State Tax ID: <span className="font-medium">{config.state_tax_id || '-'}</span>
          </p>
          <p className="text-sm text-gray-600">
            Effective From: <span className="font-medium">{new Date(config.effective_from).toLocaleDateString()}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
