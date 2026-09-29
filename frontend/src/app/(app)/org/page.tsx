'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { orgApi } from '@/lib/api/org';
import { documentsApi, DocumentsApiError, UploadedDocument } from '@/lib/api/documents';
import { DocumentUploadModal, formatBytes } from '@/components/documents/DocumentUploadModal';
import { OrgDocumentsSection } from '@/components/documents/org/OrgDocumentsSection';
import { DocumentViewerModal } from '@/components/documents/DocumentViewerModal';

/* ------------------------------ data ------------------------------ */

interface Employee {
  id: string;
  name: string;
  initials: string;
  color: string;
  title: string;
  email: string;
  managerId: string | null;
  businessUnit: string;
  department: string;
  location: string;
  costCenter: string;
}

interface RawEmployee {
  id: string;
  first_name: string;
  last_name: string;
  work_email?: string;
  department_id?: string;
  business_unit_id?: string;
  location_id?: string;
  cost_center_id?: string;
  designation_id?: string;
  manager_id?: string;
}

interface NamedEntity {
  id: string;
  name: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

function toNameMap(entities: NamedEntity[]): Record<string, string> {
  return Object.fromEntries(entities.map((e) => [e.id, e.name]));
}

const AVATAR_COLORS = [
  'from-slate-600 to-slate-800',
  'from-rose-600 to-pink-600',
  'from-blue-600 to-indigo-600',
  'from-fuchsia-600 to-purple-600',
  'from-emerald-600 to-teal-600',
  'from-amber-600 to-orange-600',
  'from-cyan-600 to-blue-600',
  'from-indigo-600 to-violet-600',
  'from-teal-600 to-emerald-600',
  'from-pink-600 to-rose-600',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function toEmployee(
  e: RawEmployee,
  departments: Record<string, string>,
  businessUnits: Record<string, string>,
  locations: Record<string, string>,
  costCenters: Record<string, string>,
  designations: Record<string, string>,
): Employee {
  const initials = `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '—';
  return {
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
    initials,
    color: colorFor(e.id),
    title: (e.designation_id && designations[e.designation_id]) || '—',
    email: e.work_email ?? '',
    managerId: e.manager_id ?? null,
    businessUnit: (e.business_unit_id && businessUnits[e.business_unit_id]) || '—',
    department: (e.department_id && departments[e.department_id]) || '—',
    location: (e.location_id && locations[e.location_id]) || '—',
    costCenter: (e.cost_center_id && costCenters[e.cost_center_id]) || '—',
  };
}

const filterKeys = ['businessUnit', 'department', 'location', 'costCenter'] as const;
type FilterKey = (typeof filterKeys)[number];

const filterMeta: Record<FilterKey, string> = {
  businessUnit: 'Business Unit',
  department: 'Department',
  location: 'Location',
  costCenter: 'Cost Center',
};

const uniqueValues = (employees: Employee[], key: FilterKey) =>
  Array.from(new Set(employees.map((e) => e[key]))).sort();

/* ------------------------------ page ------------------------------ */

export default function OrgPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'directory' | 'chart' | 'documents'>('directory');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'directory' || t === 'chart' || t === 'documents') setTab(t);
  }, [searchParams]);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [rawEmployees, departments, businessUnits, locations, costCenters, designations] =
        await Promise.all([
          fetchJson<RawEmployee[]>('/api/org-directory'),
          fetchJson<NamedEntity[]>('/api/departments'),
          fetchJson<NamedEntity[]>('/api/business-units'),
          fetchJson<NamedEntity[]>('/api/locations'),
          fetchJson<NamedEntity[]>('/api/cost-centers'),
          fetchJson<NamedEntity[]>('/api/designations'),
        ]);
      if (!mountedRef.current) return;
      const deptMap = toNameMap(departments);
      const buMap = toNameMap(businessUnits);
      const locMap = toNameMap(locations);
      const ccMap = toNameMap(costCenters);
      const desigMap = toNameMap(designations);
      setEmployees(rawEmployees.map((e) => toEmployee(e, deptMap, buMap, locMap, ccMap, desigMap)));
      // Best-effort: only marks "you" on the chart. An account without an
      // employee record (e.g. superadmin) has no profile — that must not
      // blank the directory/chart for everyone else.
      fetchJson<{ id: string }>('/api/ess/profile')
        .then((profile) => {
          if (mountedRef.current) setMeId(profile.id);
        })
        .catch(() => {});
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : 'Failed to load organisation data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      {/* Section tabs come from the uniform sub-nav in the app layout, driven by
          the ?tab= query this page reads above. */}
      <div className="p-4 sm:p-8">
        {tab === 'documents' ? (
          <OrgDocumentsSection verified={<Documents employees={employees} meId={meId} />} />
        ) : loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : tab === 'directory' ? (
          <Directory employees={employees} onChanged={reload} />
        ) : (
          <OrgChart employees={employees} meId={meId} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------ documents ------------------------------ */

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

/* Real per-employee file store (documents app, primitive #6). The previous
   mock (hardcoded policy folders) is gone: this lists the selected
   employee's `employee_document` bucket with live metadata, and HR/admin
   users can upload, preview, download and delete. The backend enforces
   everything (owner + entity_type->permission mapping + HR Admin); the
   permission checks here only decide what UI to offer. */
function Documents({ employees, meId }: { employees: Employee[]; meId: string | null }) {
  const { hasPermission, hasOrgScope } = useAuth();
  const canRead = hasPermission('documents.read');
  const canWrite = hasPermission('documents.write');
  // Broad-visibility users may browse anyone's bucket; everyone else is
  // locked to their own record (the backend 403s anything else, so offering
  // the picker would only produce failures).
  const canSeeOthers =
    hasOrgScope() ||
    hasPermission('employees.write') ||
    hasPermission('org.manage') ||
    hasPermission('employees.personal.read');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = canSeeOthers ? (selectedId ?? meId ?? employees[0]?.id ?? null) : meId;

  const [docs, setDocs] = useState<UploadedDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [viewing, setViewing] = useState<UploadedDocument | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    if (!effectiveId) {
      setDocs([]);
      return;
    }
    try {
      setLoadError(null);
      setDocs(await documentsApi.list('employee_document', effectiveId));
    } catch (e) {
      setDocs(null);
      setLoadError(e instanceof DocumentsApiError ? e.message : 'Failed to load documents');
    }
  }, [effectiveId]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const remove = async (doc: UploadedDocument) => {
    setActionError(null);
    setDeletingId(doc.id);
    try {
      await documentsApi.remove(doc.id);
      setViewing((v) => (v && v.id === doc.id ? null : v));
      await load();
    } catch (e) {
      setActionError(e instanceof DocumentsApiError ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  if (!canRead) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <h2 className="text-lg font-bold text-slate-900">Organization documents</h2>
        <p className="text-sm text-gray-500 mt-2">You don&apos;t have permission to view documents.</p>
      </div>
    );
  }

  const selected = employees.find((e) => e.id === effectiveId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Organization documents</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Files on the selected employee&apos;s record — upload, preview, download or delete.
          </p>
        </div>
        {canWrite && effectiveId && (
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            Upload document
          </button>
        )}
      </div>

      {canSeeOthers && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-3 flex items-center gap-3 flex-wrap">
          <label htmlFor="org-docs-employee" className="text-sm font-medium text-slate-700">
            Employee
          </label>
          <select
            id="org-docs-employee"
            value={effectiveId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="min-w-0 flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{actionError}</p>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <span className="w-9 h-9 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0">
            <FolderIcon className="w-4 h-4" />
          </span>
          <h3 className="text-base font-bold text-slate-900">
            {selected ? `${selected.name}'s documents` : 'Documents'}
          </h3>
          {docs && (
            <span className="text-xs text-gray-400">
              {docs.length} document{docs.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          {loadError ? (
            <p className="px-5 py-8 text-center text-sm text-red-600">{loadError}</p>
          ) : docs === null ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">Loading...</p>
          ) : docs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              No documents on this record yet{canWrite ? ' — upload the first one above.' : '.'}
            </p>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Document</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Size</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Uploaded by</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Uploaded at</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Expires</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => setViewing(doc)}
                        className="text-sm font-medium text-purple-600 hover:text-purple-700 hover:underline text-left"
                      >
                        {doc.originalFilename}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">{doc.contentType || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">
                      {typeof doc.size === 'number' ? formatBytes(doc.size) : (doc.fileSize != null ? formatBytes(doc.fileSize) : '—')}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">{doc.uploadedByName || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">
                      {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">
                      {doc.expiryDate ?? '—'}
                      {doc.isExpired && (
                        <span className="ml-2 text-xs font-medium text-red-600">Expired</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setViewing(doc)}
                          className="text-purple-600 hover:text-purple-700 hover:underline"
                        >
                          View
                        </button>
                        {doc.downloadUrl && (
                          <a href={doc.downloadUrl} className="text-purple-600 hover:text-purple-700 hover:underline">
                            Download
                          </a>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            disabled={deletingId === doc.id}
                            onClick={() => void remove(doc)}
                            className="text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
                          >
                            {deletingId === doc.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showUpload && effectiveId && (
        <DocumentUploadModal
          title={`Upload to ${selected ? selected.name : 'employee'}'s record`}
          entityType="employee_document"
          entityId={effectiveId}
          employeeId={Number(effectiveId)}
          allowExpiryDate
          onUploaded={() => {
            setShowUpload(false);
            void load();
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
      {viewing && <DocumentViewerModal document={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ------------------------------ directory ------------------------------ */

function Directory({ employees, onChanged }: { employees: Employee[]; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    businessUnit: '',
    department: '',
    location: '',
    costCenter: '',
  });
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [view, setView] = useState<'list' | 'gallery'>('list');

  const hasActiveFilter = Object.values(filters).some(Boolean) || search.trim() !== '';

  const rows = useMemo(() => {
    return employees.filter((e) => {
      for (const key of filterKeys) {
        if (filters[key] && e[key] !== filters[key]) return false;
      }
      if (search.trim()) {
        const hay = `${e.name} ${e.title} ${e.email} ${e.department}`.toLowerCase();
        if (!hay.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [employees, filters, search]);

  const clearAll = () => {
    setFilters({ businessUnit: '', department: '', location: '', costCenter: '' });
    setSearch('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900">Employee Directory</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div role="group" aria-label="Change view" className="flex rounded-xl border border-gray-200 bg-gray-50 p-0.5">
            {(['list', 'gallery'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {v === 'list' ? 'List' : 'Gallery'}
              </button>
            ))}
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Add employee
            </button>
          ) : null}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          {filterKeys.map((key) => (
            <div key={key} className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                {filterMeta[key]}
              </label>
              <select
                value={filters[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-purple-400"
              >
                <option value="">All</option>
                {uniqueValues(employees, key).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="min-w-[180px] flex-1">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, title or email"
              className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-purple-400"
            />
          </div>
          {hasActiveFilter ? (
            <button
              onClick={clearAll}
              className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-slate-900">Employees</h2>
          <span className="text-xs text-gray-500">
            Showing {rows.length} of {employees.length}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500">No employees match these filters.</p>
        ) : view === 'gallery' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {rows.map((e) => (
              <div key={e.id} className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-lg transition-shadow">
                <div className="flex items-center gap-3 mb-1">
                  <span
                    className={`w-10 h-10 rounded-full bg-gradient-to-br ${e.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                  >
                    {e.initials}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{e.name}</h3>
                    <p className="text-indigo-600 text-sm font-semibold truncate">{e.title}</p>
                  </div>
                </div>
                <div className="space-y-1 text-sm mt-2">
                  <p className="text-gray-600">{e.department}</p>
                  <p className="text-gray-500">{e.location}</p>
                  {e.email ? (
                    <p className="text-blue-600 truncate">{e.email}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Employee</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Department</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Business Unit</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Location</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Cost Center</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-8 h-8 rounded-full bg-gradient-to-br ${e.color} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}
                        >
                          {e.initials}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{e.name}</p>
                          <p className="text-xs text-gray-500 truncate">{e.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700">{e.department}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">{e.businessUnit}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">{e.location}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">{e.costCenter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd ? (
        <AddEmployeeModal
          employees={employees}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ add employee ------------------------------ */

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];

/**
 * Creates a real Employee row (POST /api/employees). The manager select sets
 * the reports-to link, so the new person appears under their manager in the
 * chart as soon as the directory refetches — no manual DB reload.
 */
function AddEmployeeModal({
  employees,
  onClose,
  onCreated,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [departments, setDepartments] = useState<NamedEntity[]>([]);
  const [designations, setDesignations] = useState<NamedEntity[]>([]);
  const [locations, setLocations] = useState<NamedEntity[]>([]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [depts, desigs, locs] = await Promise.all([
          fetchJson<NamedEntity[]>('/api/departments'),
          fetchJson<NamedEntity[]>('/api/designations'),
          fetchJson<NamedEntity[]>('/api/locations'),
        ]);
        if (!cancelled) {
          setDepartments(depts);
          setDesignations(desigs);
          setLocations(locs);
        }
      } catch {
        /* options stay empty; the form still submits */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !workEmail.trim() || !employeeCode.trim()) {
      setFormError('First name, work email and employee code are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await orgApi.createEmployee({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        work_email: workEmail.trim(),
        employee_code: employeeCode.trim(),
        department_id: departmentId || null,
        designation_id: designationId || null,
        location_id: locationId || null,
        manager_id: managerId || null,
        employment_type: employmentType,
        date_of_joining: dateOfJoining || null,
      });
      onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the employee.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'mt-1 block w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-purple-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add employee"
    >
      <form
        onSubmit={submit}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-lg p-5"
      >
        <h3 className="text-base font-bold text-slate-900">Add employee</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Saved to the employee directory — the new person shows in the directory and under their
          manager in the chart.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">First name *</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Work email *</span>
            <input
              type="email"
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Employee code *</span>
            <input
              type="text"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="e.g. EMP-0147"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Department</span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Designation</span>
            <select
              value={designationId}
              onChange={(e) => setDesignationId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Location</span>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Manager (reports to)</span>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className={inputClass}
            >
              <option value="">No manager (top of org)</option>
              {employees.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Employment type</span>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              className={inputClass}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600">Date of joining</span>
            <input
              type="date"
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {formError ? <p className="mt-3 text-xs text-rose-700">{formError}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saving ? 'Adding…' : 'Add employee'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ org chart ------------------------------ */

function ancestorsOf(employees: Employee[], id: string): string[] {
  const byId = (i: string) => employees.find((e) => e.id === i);
  const chain: string[] = [];
  let cur = byId(id);
  while (cur?.managerId != null) {
    chain.push(cur.managerId);
    cur = byId(cur.managerId);
  }
  return chain;
}

/**
 * The default collapsed set: every manager at depth >= 1 (i.e. below the top
 * level) starts collapsed, so the first paint shows roots + their direct
 * reports only instead of all 146 people sprawling horizontally without
 * bound. The user expands subtrees (or Expand all) from there. Depth is
 * measured from the visible roots (no manager, or manager outside the list).
 */
function defaultCollapsedFor(list: Employee[]): Set<string> {
  const ids = new Set(list.map((e) => e.id));
  const childCount = new Map<string, number>();
  for (const e of list) {
    if (e.managerId && ids.has(e.managerId)) {
      childCount.set(e.managerId, (childCount.get(e.managerId) ?? 0) + 1);
    }
  }
  const depth = new Map<string, number>();
  const queue: { id: string; d: number }[] = list
    .filter((e) => !e.managerId || !ids.has(e.managerId))
    .map((e) => ({ id: e.id, d: 0 }));
  for (let i = 0; i < queue.length; i++) {
    const { id, d } = queue[i];
    if (depth.has(id)) continue;
    depth.set(id, d);
    for (const e of list) {
      if (e.managerId === id) queue.push({ id: e.id, d: d + 1 });
    }
  }
  const collapsed = new Set<string>();
  for (const e of list) {
    if ((depth.get(e.id) ?? 0) >= 1 && (childCount.get(e.id) ?? 0) > 0) {
      collapsed.add(e.id);
    }
  }
  return collapsed;
}

/** Every manager in the list, whatever their depth — the fully folded view. */
function allCollapsedFor(list: Employee[]): Set<string> {
  const ids = new Set(list.map((e) => e.id));
  const hasChild = new Set<string>();
  for (const e of list) {
    if (e.managerId && ids.has(e.managerId)) hasChild.add(e.managerId);
  }
  return hasChild;
}

function OrgChart({ employees, meId }: { employees: Employee[]; meId: string | null }) {
  const byId = (id: string) => employees.find((e) => e.id === id);
  const me = meId ? byId(meId) : undefined;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupByDept, setGroupByDept] = useState(false);
  const [deptFocus, setDeptFocus] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [zoom, setZoom] = useState(1);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  // Fold the chart to the default two-level view on first load, so a wide org
  // (17 departments, 146 people) doesn't paint fully expanded and sprawl
  // off-screen. Runs once — later toggles and refetches are the user's own.
  const autoFoldedRef = useRef(false);
  useEffect(() => {
    if (autoFoldedRef.current || employees.length === 0) return;
    autoFoldedRef.current = true;
    setCollapsed(defaultCollapsedFor(employees));
  }, [employees]);

  const zoomIn = () => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10));
  const zoomReset = () => setZoom(1);

  // Ctrl+wheel zooms (native non-passive listener so preventDefault works).
  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandTo = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      ancestorsOf(employees, id).forEach((a) => next.delete(a));
      return next;
    });

  const scrollToNode = (id: string) =>
    window.setTimeout(() => {
      document.getElementById(`org-node-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 60);

  const goTopOfOrg = () => {
    setGroupByDept(false);
    setDeptFocus(false);
    setCollapsed(defaultCollapsedFor(employees));
    setHighlightId(null);
  };

  const goMyDepartment = () => {
    setGroupByDept(false);
    setDeptFocus(true);
    setHighlightId(null);
  };

  const goMe = () => {
    if (!meId) return;
    setGroupByDept(false);
    setDeptFocus(false);
    expandTo(meId);
    setHighlightId(meId);
    scrollToNode(meId);
  };

  const exportChart = () => {
    const lines: string[] = ['Organisation Chart', ''];
    const walk = (emp: Employee, depth: number) => {
      lines.push(`${'  '.repeat(depth)}${emp.name} — ${emp.title} (${emp.department})`);
      employees.filter((e) => e.managerId === emp.id).forEach((c) => walk(c, depth + 1));
    };
    employees.filter((e) => e.managerId === null).forEach((r) => walk(r, 0));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'org-chart.txt';
    a.click();
    URL.revokeObjectURL(url);
    setToast('Organisation chart exported');
    window.setTimeout(() => setToast(''), 2500);
  };

  // "Root" = no manager, or a manager outside what this viewer's scope can
  // see (e.g. a self-scoped employee whose real manager isn't in the list).
  const visibleIds = new Set(employees.map((e) => e.id));
  const deptFilter = deptFocus ? me?.department : undefined;
  const roots = deptFilter
    ? employees.filter((e) => e.department === deptFilter && (e.managerId ? byId(e.managerId)?.department : undefined) !== deptFilter)
    : employees.filter((e) => e.managerId === null || !visibleIds.has(e.managerId));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Go to</span>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white">
            <button
              onClick={goMyDepartment}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                deptFocus ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Department
            </button>
            <button
              onClick={goTopOfOrg}
              className={`px-3 py-2 text-sm font-medium border-l border-gray-200 transition-colors ${
                !deptFocus && !groupByDept ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Top of the Org
            </button>
            <button
              onClick={goMe}
              className="px-3 py-2 text-sm font-medium border-l border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Me
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Zoom controls */}
          <div
            className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden bg-white"
            role="group"
            aria-label="Chart zoom"
          >
            <button
              onClick={zoomOut}
              disabled={zoom <= 0.4}
              className="px-2.5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={zoomReset}
              className="px-2 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors border-l border-gray-200"
              title="Reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= 2}
              className="px-2.5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors border-l border-gray-200 disabled:opacity-40"
              title="Zoom in (or Ctrl+scroll)"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <button
            onClick={() => setCollapsed(new Set())}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
            title="Expand every node"
          >
            Expand all
          </button>
          <button
            onClick={() => setCollapsed(allCollapsedFor(employees))}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
            title="Fold every subtree back to the top level"
          >
            Collapse all
          </button>
          <button
            onClick={() => setGroupByDept((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <span
              className={`relative w-9 h-5 rounded-full transition-colors ${groupByDept ? 'bg-purple-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  groupByDept ? 'translate-x-4' : ''
                }`}
              />
            </span>
            Group by department
          </button>
          <button
            onClick={exportChart}
            className="p-2 text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg"
            title="Export organisation chart"
            aria-label="Export organisation chart"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={chartScrollRef} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-10 overflow-auto">
        <div
          className="flex justify-center gap-10 min-w-max"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
        >
          {roots.map((r) => (
            <OrgNode
              key={r.id}
              employee={r}
              employees={employees}
              collapsed={collapsed}
              onToggle={toggle}
              deptFilter={deptFilter}
              highlightId={highlightId}
              grouped={groupByDept}
            />
          ))}
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

const deptTheme: Record<string, string> = {
  Technology: 'border-blue-300 bg-blue-50/40',
  Design: 'border-fuchsia-300 bg-fuchsia-50/40',
  Finance: 'border-emerald-300 bg-emerald-50/40',
  People: 'border-amber-300 bg-amber-50/40',
  Consulting: 'border-violet-300 bg-violet-50/40',
  Management: 'border-slate-300 bg-slate-50/60',
};

// Connector stub classes for a column at position `i` of `count` siblings.
function connectorClass(i: number, count: number) {
  if (count === 1) return '';
  const base =
    "before:content-[''] before:absolute before:top-0 before:h-6 before:w-px before:bg-gray-300 before:left-1/2 " +
    "after:content-[''] after:absolute after:top-0 after:h-px after:bg-gray-300 ";
  if (i === 0) return base + 'after:left-1/2 after:right-0';
  if (i === count - 1) return base + 'after:left-0 after:right-1/2';
  return base + 'after:left-0 after:right-0';
}

function groupByDepartment(list: Employee[]) {
  const groups: { dept: string; bu: string; members: Employee[] }[] = [];
  for (const e of list) {
    const last = groups[groups.length - 1];
    if (last && last.dept === e.department) last.members.push(e);
    else groups.push({ dept: e.department, bu: e.businessUnit, members: [e] });
  }
  return groups;
}

function OrgNode({
  employee,
  employees,
  collapsed,
  onToggle,
  deptFilter,
  highlightId,
  grouped,
}: {
  employee: Employee;
  employees: Employee[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  deptFilter?: string;
  highlightId?: string | null;
  grouped?: boolean;
}) {
  const reports = employees.filter(
    (e) => e.managerId === employee.id && (!deptFilter || e.department === deptFilter),
  );
  const isCollapsed = collapsed.has(employee.id);
  const showChildren = reports.length > 0 && !isCollapsed;
  const single = reports.length === 1;
  const groups = grouped ? groupByDepartment(reports) : [];

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div
        id={`org-node-${employee.id}`}
        className={`relative w-56 rounded-xl border bg-white shadow-sm px-3 py-3 ${
          highlightId === employee.id ? 'border-purple-400 ring-2 ring-purple-200' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`w-10 h-10 rounded-full bg-gradient-to-br ${employee.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}
          >
            {employee.initials}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{employee.name}</p>
            <p className="text-xs text-gray-500 truncate">{employee.title}</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 truncate">
          {employee.businessUnit} · {employee.department}
        </p>

        {reports.length > 0 ? (
          <button
            onClick={() => onToggle(employee.id)}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center shadow hover:bg-purple-700 z-10"
            aria-label={isCollapsed ? 'Expand reports' : 'Collapse reports'}
          >
            {isCollapsed ? reports.length : '–'}
          </button>
        ) : null}
      </div>

      {/* Connector down from this card */}
      {showChildren ? <div className="w-px h-6 bg-gray-300" /> : null}

      {/* Children row — grouped by department */}
      {showChildren && grouped ? (
        <div className="flex">
          {groups.map((g, gi) => (
            <div
              key={g.dept + gi}
              className={`relative flex flex-col items-center px-4 pt-6 ${
                groups.length === 1 ? '' : connectorClass(gi, groups.length)
              }`}
            >
              {groups.length === 1 ? <div className="absolute top-0 left-1/2 w-px h-6 bg-gray-300" /> : null}
              <div className={`rounded-2xl border-2 ${deptTheme[g.dept] ?? 'border-gray-300 bg-gray-50/50'} p-4`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  {g.bu} <span className="mx-1">›</span> {g.dept}
                </p>
                <div className="flex gap-6">
                  {g.members.map((child) => (
                    <OrgNode
                      key={child.id}
                      employee={child}
                      employees={employees}
                      collapsed={collapsed}
                      onToggle={onToggle}
                      deptFilter={deptFilter}
                      highlightId={highlightId}
                      grouped
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Children row — plain */}
      {showChildren && !grouped ? (
        <div className="flex">
          {reports.map((child, i) => (
            <div
              key={child.id}
              className={`relative flex flex-col items-center px-4 pt-6 ${
                single ? '' : connectorClass(i, reports.length)
              }`}
            >
              {single ? <div className="absolute top-0 left-1/2 w-px h-6 bg-gray-300" /> : null}
              <OrgNode
                employee={child}
                employees={employees}
                collapsed={collapsed}
                onToggle={onToggle}
                deptFilter={deptFilter}
                highlightId={highlightId}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
