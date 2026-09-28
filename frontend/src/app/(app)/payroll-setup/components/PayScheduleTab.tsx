'use client';

import { useState, useEffect } from 'react';

interface PaySchedule {
  id: string;
  name: string;
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  pay_period_start_day: number;
  cutoff_day: number;
  pay_date_offset_days: number;
  first_cycle_start_date: string;
  is_active: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function PayScheduleTab() {
  const [schedules, setSchedules] = useState<PaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<PaySchedule>>({});

  useEffect(() => {
    const loadSchedules = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<{ results: PaySchedule[] }>('/api/payroll-setup/pay-schedules/');
        setSchedules(data.results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pay schedules');
      } finally {
        setLoading(false);
      }
    };

    loadSchedules();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method = formData.id ? 'PUT' : 'POST';
      const url = formData.id ? `/api/payroll-setup/pay-schedules/${formData.id}/` : '/api/payroll-setup/pay-schedules/';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(body?.error?.message || 'Failed to save pay schedule');
      }

      // Reload schedules
      const updated = await fetchJson<{ results: PaySchedule[] }>('/api/payroll-setup/pay-schedules/');
      setSchedules(updated.results);
      setShowForm(false);
      setFormData({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pay schedule');
    }
  };

  if (loading) return <div className="text-gray-500">Loading pay schedules...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {schedules.length === 0 && !showForm && (
        <div className="text-gray-500 text-center py-8">No pay schedules configured</div>
      )}

      {schedules.map((schedule) => (
        <div key={schedule.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="font-semibold text-slate-900">{schedule.name}</h4>
          <p className="text-sm text-gray-600 mt-2">
            Frequency: <span className="font-medium">{schedule.frequency}</span>
          </p>
          <p className="text-sm text-gray-600">
            Cutoff Day: <span className="font-medium">{schedule.cutoff_day}</span>
          </p>
          <p className="text-sm text-gray-600">
            Pay Date Offset: <span className="font-medium">{schedule.pay_date_offset_days} days</span>
          </p>
          <p className="text-sm text-gray-600">
            Status: <span className={schedule.is_active ? 'text-green-600' : 'text-gray-600'}>{schedule.is_active ? 'Active' : 'Inactive'}</span>
          </p>
        </div>
      ))}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <input
            type="text"
            placeholder="Schedule Name"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          />
          <select
            value={formData.frequency || ''}
            onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          >
            <option value="">Select Frequency</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="semimonthly">Semi-monthly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input
            type="number"
            placeholder="Pay Period Start Day (1-31)"
            value={formData.pay_period_start_day || ''}
            onChange={(e) => setFormData({ ...formData, pay_period_start_day: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          />
          <input
            type="number"
            placeholder="Cutoff Day (1-31)"
            value={formData.cutoff_day || ''}
            onChange={(e) => setFormData({ ...formData, cutoff_day: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          />
          <input
            type="date"
            placeholder="First Cycle Start Date"
            value={formData.first_cycle_start_date || ''}
            onChange={(e) => setFormData({ ...formData, first_cycle_start_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          />
          <div className="flex gap-3">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormData({});
              }}
              className="px-4 py-2 bg-gray-300 text-gray-900 rounded-lg hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add Pay Schedule
        </button>
      )}
    </div>
  );
}
