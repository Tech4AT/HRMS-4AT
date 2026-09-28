'use client';

import { useState, useEffect } from 'react';

interface PayStubTemplate {
  id: string;
  name: string;
  applies_to: 'employee' | 'contractor';
  delivery_method: 'email' | 'portal' | 'both';
  is_default: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function PayStubTab() {
  const [templates, setTemplates] = useState<PayStubTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<{ results: PayStubTemplate[] }>('/api/payroll-setup/pay-stub-templates/');
        setTemplates(data.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pay stub templates');
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, []);

  if (loading) return <div className="text-gray-500">Loading pay stub templates...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {templates.length === 0 && (
        <div className="text-gray-500 text-center py-8">No pay stub templates configured</div>
      )}

      {templates.map((template) => (
        <div key={template.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-semibold text-slate-900">{template.name}</h4>
              <p className="text-sm text-gray-600 mt-2">
                Applies To: <span className="font-medium capitalize">{template.applies_to}</span>
              </p>
              <p className="text-sm text-gray-600">
                Delivery: <span className="font-medium capitalize">{template.delivery_method.replace('_', ' ')}</span>
              </p>
            </div>
            {template.is_default && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">Default</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
