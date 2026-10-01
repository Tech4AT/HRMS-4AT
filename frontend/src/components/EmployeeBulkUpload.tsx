'use client';

import { useState } from 'react';

interface UploadResult {
  success: boolean;
  data?: {
    created: Array<{ employee_code: string; name: string }>;
    updated: Array<{ employee_code: string; name: string }>;
    skipped: Array<{ row: number; reason: string }>;
    errors: Array<{ row: number; employee_code: string; error: string }>;
    departments_created: string[];
    designations_created: string[];
    summary: {
      total_created: number;
      total_updated: number;
      total_skipped: number;
      total_errors: number;
    };
  };
  error?: string;
}

export default function EmployeeBulkUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('[Bulk Upload] Uploading file:', file.name, file.type, file.size);

      const response = await fetch('/api/employees/bulk-upload/', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      console.log('[Bulk Upload] Fetch completed');

      const text = await response.text();
      console.log('[Bulk Upload] Response status:', response.status);
      console.log('[Bulk Upload] Response headers:', {
        contentType: response.headers.get('content-type'),
      });
      console.log('[Bulk Upload] Response text length:', text.length);
      console.log('[Bulk Upload] Response text:', text);
      console.log('[Bulk Upload] Response OK:', response.ok);

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('[Bulk Upload] JSON parse error:', parseError);
        setResult({
          success: false,
          error: `Server error (${response.status}): ${text.substring(0, 200)}`,
        });
        setLoading(false);
        return;
      }

      setResult(data);
    } catch (err) {
      console.error('[Bulk Upload] Error:', err);
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">📥 Bulk Employee Import</h2>

      {/* Upload Section */}
      <div className="space-y-4 mb-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={loading}
            className="hidden"
            id="file-input"
          />
          <label htmlFor="file-input" className="cursor-pointer">
            <div className="text-4xl mb-2">📄</div>
            <p className="text-sm font-medium text-slate-900">
              {file ? file.name : 'Click to select or drag Excel file'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Only .xlsx and .xls files</p>
          </label>
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
        >
          {loading ? '⏳ Processing...' : '📤 Upload & Import'}
        </button>
      </div>

      {/* Results Section */}
      {result && (
        <div className="space-y-4">
          {result.success ? (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="text-2xl font-bold text-green-600">
                    {result.data?.summary.total_created}
                  </div>
                  <div className="text-sm text-gray-600">Created</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="text-2xl font-bold text-blue-600">
                    {result.data?.summary.total_updated}
                  </div>
                  <div className="text-sm text-gray-600">Updated</div>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <div className="text-2xl font-bold text-yellow-600">
                    {result.data?.summary.total_skipped}
                  </div>
                  <div className="text-sm text-gray-600">Skipped</div>
                </div>
                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                  <div className="text-2xl font-bold text-red-600">
                    {result.data?.summary.total_errors}
                  </div>
                  <div className="text-sm text-gray-600">Errors</div>
                </div>
              </div>

              {/* Departments Created */}
              {result.data?.departments_created && result.data.departments_created.length > 0 && (
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                  <h3 className="font-semibold text-purple-900 mb-2">
                    ✨ New Departments Created ({result.data.departments_created.length})
                  </h3>
                  <div className="text-sm text-purple-700">
                    {result.data.departments_created.join(', ')}
                  </div>
                </div>
              )}

              {/* Designations Created */}
              {result.data?.designations_created && result.data.designations_created.length > 0 && (
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                  <h3 className="font-semibold text-indigo-900 mb-2">
                    ✨ New Designations Created ({result.data.designations_created.length})
                  </h3>
                  <div className="text-sm text-indigo-700 max-h-24 overflow-y-auto">
                    {result.data.designations_created.join(', ')}
                  </div>
                </div>
              )}

              {/* Created Employees */}
              {result.data?.created && result.data.created.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h3 className="font-semibold text-green-900 mb-2">✅ Created Employees</h3>
                  <div className="text-sm text-green-700 max-h-32 overflow-y-auto space-y-1">
                    {result.data.created.map((emp, i) => (
                      <div key={i}>{emp.employee_code} - {emp.name}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated Employees */}
              {result.data?.updated && result.data.updated.length > 0 && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h3 className="font-semibold text-blue-900 mb-2">🔄 Updated Employees</h3>
                  <div className="text-sm text-blue-700 max-h-32 overflow-y-auto space-y-1">
                    {result.data.updated.map((emp, i) => (
                      <div key={i}>{emp.employee_code} - {emp.name}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.data?.errors && result.data.errors.length > 0 && (
                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                  <h3 className="font-semibold text-red-900 mb-2">❌ Errors</h3>
                  <div className="text-sm text-red-700 max-h-32 overflow-y-auto space-y-1">
                    {result.data.errors.map((err, i) => (
                      <div key={i}>
                        Row {err.row}: {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <h3 className="font-semibold text-red-900">❌ Upload Failed</h3>
              <p className="text-sm text-red-700 mt-1">
                {typeof result.error === 'string'
                  ? result.error
                  : (result.error as any)?.message || 'Upload failed'}
              </p>
            </div>
          )}

          <button
            onClick={() => {
              setResult(null);
              setFile(null);
            }}
            className="w-full px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 font-medium"
          >
            Upload Another File
          </button>
        </div>
      )}
    </div>
  );
}
