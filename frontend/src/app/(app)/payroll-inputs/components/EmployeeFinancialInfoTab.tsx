'use client';

import { useState, useEffect } from 'react';

interface PaymentInfo {
  id: string;
  employee_id: string;
  payment_method: 'direct_deposit' | 'cash' | 'paper_check';
  bank_name: string;
  bank_account_number: string;
  bank_ifsc_code: string;
  bank_account_holder_name: string;
}

interface Props {
  employeeId: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

export default function EmployeeFinancialInfoTab({ employeeId }: Props) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<PaymentInfo>>({});

  useEffect(() => {
    if (!employeeId) return;

    const loadPaymentInfo = async () => {
      try {
        setLoading(true);
        const data = await fetchJson<PaymentInfo[]>(
          `/api/payroll-inputs/payment-info/?employee_id=${employeeId}`
        );
        setPaymentInfo(data[0] || null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payment info');
      } finally {
        setLoading(false);
      }
    };

    loadPaymentInfo();
  }, [employeeId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return;

    try {
      const method = paymentInfo ? 'PUT' : 'POST';
      const url = paymentInfo
        ? `/api/payroll-inputs/payment-info/${paymentInfo.id}/`
        : '/api/payroll-inputs/payment-info/';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, ...formData }),
      });

      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(body?.error?.message || 'Failed to save');
      }

      setPaymentInfo(body.data);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment info');
    }
  };

  if (!employeeId) return <div className="text-gray-500">Select an employee to view financial information</div>;
  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 p-3 bg-red-50 rounded-lg">{error}</div>}

      {!editMode && paymentInfo && (
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-2">
          <p className="text-sm">
            Payment Method: <span className="font-medium capitalize">{paymentInfo.payment_method.replace('_', ' ')}</span>
          </p>
          {paymentInfo.payment_method === 'direct_deposit' && (
            <>
              <p className="text-sm">
                Bank: <span className="font-medium">{paymentInfo.bank_name}</span>
              </p>
              <p className="text-sm">
                Account: <span className="font-medium">****{paymentInfo.bank_account_number.slice(-4)}</span>
              </p>
              <p className="text-sm">
                IFSC: <span className="font-medium">{paymentInfo.bank_ifsc_code}</span>
              </p>
              <p className="text-sm">
                Holder: <span className="font-medium">{paymentInfo.bank_account_holder_name}</span>
              </p>
            </>
          )}
          <button
            onClick={() => {
              setFormData(paymentInfo);
              setEditMode(true);
            }}
            className="mt-3 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Edit
          </button>
        </div>
      )}

      {editMode && (
        <form onSubmit={handleSave} className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <select
            value={formData.payment_method || ''}
            onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as any })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            required
          >
            <option value="">Select Payment Method</option>
            <option value="direct_deposit">Direct Deposit</option>
            <option value="cash">Cash</option>
            <option value="paper_check">Paper Check</option>
          </select>

          {formData.payment_method === 'direct_deposit' && (
            <>
              <input
                type="text"
                placeholder="Bank Name"
                value={formData.bank_name || ''}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
              <input
                type="text"
                placeholder="Account Number"
                value={formData.bank_account_number || ''}
                onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
              <input
                type="text"
                placeholder="IFSC Code"
                value={formData.bank_ifsc_code || ''}
                onChange={(e) => setFormData({ ...formData, bank_ifsc_code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
              <input
                type="text"
                placeholder="Account Holder Name"
                value={formData.bank_account_holder_name || ''}
                onChange={(e) => setFormData({ ...formData, bank_account_holder_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
            </>
          )}

          <div className="flex gap-3">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className="px-4 py-2 bg-gray-300 text-gray-900 rounded-lg hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!paymentInfo && !editMode && (
        <button
          onClick={() => {
            setFormData({});
            setEditMode(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add Payment Information
        </button>
      )}
    </div>
  );
}
