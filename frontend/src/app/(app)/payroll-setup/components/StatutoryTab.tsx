'use client';

import { useState, useEffect } from 'react';

interface StatutoryConfig {
  id: string;
  legal_entity: string;
  legal_entity_name: string;
  contribution_type: 'PF' | 'ESI' | 'LWF' | 'PROFESSIONAL_TAX';
  is_enabled: boolean;
  registration_number: string;
  effective_date: string;
  signatory_name: string;
  signatory_designation: string;
  signatory_pan: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function StatutoryTab() {
  const [configs, setConfigs] = useState<StatutoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const confData = await fetchJson<{ results: StatutoryConfig[] }>(
          '/api/payroll-setup/statutory-configs/',
        );
        setConfigs(confData.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load statutory configurations');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);


  if (loading) return <div className="text-gray-500">Loading statutory configurations...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {configs.length === 0 && <div className="text-gray-500 text-center py-8">No statutory configurations</div>}

      {configs.map((config) => (
        <div key={config.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-semibold text-slate-900">{config.legal_entity_name}</h4>
              <p className="text-sm text-gray-600 mt-1">
                Type: <span className="font-medium">{config.contribution_type}</span>
              </p>
              <p className="text-sm text-gray-600">
                Registration: <span className="font-medium">{config.registration_number}</span>
              </p>
              <p className="text-sm text-gray-600">
                Signatory: <span className="font-medium">{config.signatory_name}</span>
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                config.is_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'
              }`}
            >
              {config.is_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      ))}

      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          To add or modify statutory configurations, use the backend admin or API.
        </p>
      </div>
    </div>
  );
}
