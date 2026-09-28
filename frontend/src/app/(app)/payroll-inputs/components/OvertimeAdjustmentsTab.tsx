'use client';

import { useState, useEffect } from 'react';

interface OvertimeAdjustment {
  id: string;
  employee_id: string;
  pay_period_month: string;
  overtime_hours: number;
  overtime_rate_multiplier: number;
  leave_adjustment_days: number;
  notes: string;
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

export default function OvertimeAdjustmentsTab({ employeeId }: Props) {
  const [adjustments, setAdjustments] = useState<OvertimeAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<OvertimeAdjustment[]>(
          `/api/payroll-inputs/overtime-adjustments/?employee_id=${employeeId}`
        );
        setAdjustments(data);
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
      {adjustments.length === 0 && <div className="text-gray-500 text-center py-8">No adjustments</div>}
      {adjustments.map((a) => (
        <div key={a.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-sm font-semibold text-slate-900">
            {new Date(a.pay_period_month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
          <p className="text-sm text-gray-600 mt-2">Overtime Hours: <span className="font-medium">{a.overtime_hours}</span></p>
          <p className="text-sm text-gray-600">Rate Multiplier: <span className="font-medium">{a.overtime_rate_multiplier}x</span></p>
          {a.leave_adjustment_days !== 0 && (
            <p className="text-sm text-gray-600">Leave Adjustment: <span className="font-medium">{a.leave_adjustment_days} days</span></p>
          )}
          {a.notes && <p className="text-sm text-gray-600 mt-2">Notes: {a.notes}</p>}
        </div>
      ))}
    </div>
  );
}
