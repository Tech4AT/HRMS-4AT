/**
 * Browser-side Assets API client. Talks only to the local `/api/assets/*`
 * route handlers (never the backend directly); those proxy to the Django
 * `assets` app and carry the httpOnly session cookie.
 *
 * The backend renders camelCase (ContractPageNumberPagination:
 * `{results, total, page, pageSize}`).
 */

export type AssetStatus = 'assigned' | 'available' | 'recovered';

export interface Asset {
  id: number;
  assetTag: string;
  category: string;
  brand: string;
  serial: string;
  processor: string;
  ram: string;
  dateOfAllotment: string | null;
  dateOfRecover: string | null;
  hasBag: boolean;
  previouslyUsed: string;
  assignedTo: number | null;
  assignedToName: string;
  status: AssetStatus;
}

/** The query-param filters the backend applies to list, export and stats. */
export interface AssetFilters {
  search?: string;
  status?: AssetStatus | '';
  assigned?: 'true' | 'false' | '';
  category?: string;
  brand?: string;
  hasBag?: 'true' | 'false' | '';
  allottedFrom?: string;
  allottedTo?: string;
  allottedYear?: string;
  recoveredFrom?: string;
  recoveredTo?: string;
}

export interface AssetListParams extends AssetFilters {
  page?: number;
  pageSize?: number;
}

export interface AssetStats {
  total: number;
  assigned: number;
  available: number;
  recovered: number;
  byCategory: Record<string, number>;
  issuedThisYear: number;
}

/** Build the shared filter querystring (snake_case keys the backend reads). */
function filterQuery(f: AssetFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.search) q.set('search', f.search);
  if (f.status) q.set('status', f.status);
  if (f.assigned) q.set('assigned', f.assigned);
  if (f.category) q.set('category', f.category);
  if (f.brand) q.set('brand', f.brand);
  if (f.hasBag) q.set('has_bag', f.hasBag);
  if (f.allottedFrom) q.set('allotted_from', f.allottedFrom);
  if (f.allottedTo) q.set('allotted_to', f.allottedTo);
  if (f.allottedYear) q.set('allotted_year', f.allottedYear);
  if (f.recoveredFrom) q.set('recovered_from', f.recoveredFrom);
  if (f.recoveredTo) q.set('recovered_to', f.recoveredTo);
  return q;
}

export interface AssetListResult {
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
}

export class AssetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AssetsApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const json = (await res.json().catch(() => null)) as {
    results?: unknown;
    total?: number;
    page?: number;
    pageSize?: number;
    detail?: string;
  } | null;
  if (!res.ok || !json) {
    const message =
      (json as { detail?: string } | null)?.detail || `Request failed (${res.status})`;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new AssetsApiError(message, res.status);
  }
  return json as T;
}

export async function listAssets(params: AssetListParams = {}): Promise<AssetListResult> {
  const query = filterQuery(params);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.toString();
  const json = await request<{
    results: Asset[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/assets${suffix ? `?${suffix}` : ''}`);
  return { items: json.results ?? [], total: json.total ?? 0, page: json.page ?? 1, pageSize: json.pageSize ?? 20 };
}

/** KPI counts over the scoped + filtered queryset (backend camelCases keys). */
export async function fetchAssetStats(filters: AssetFilters = {}): Promise<AssetStats> {
  const suffix = filterQuery(filters).toString();
  return request<AssetStats>(`/api/assets/stats${suffix ? `?${suffix}` : ''}`);
}

/** URL of the CSV export for the current filters — point a link/button at it. */
export function assetExportUrl(filters: AssetFilters = {}): string {
  const suffix = filterQuery(filters).toString();
  return `/api/assets/export${suffix ? `?${suffix}` : ''}`;
}

/** Assign (or unassign with null) an asset. Requires assets.write. */
export async function assignAsset(id: number, assignedTo: number | null): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedTo }),
  });
}

/** Editable fields of an asset — the write shape for create/update. */
export interface AssetInput {
  assetTag: string;
  category?: string;
  brand?: string;
  serial?: string;
  processor?: string;
  ram?: string;
  dateOfAllotment?: string | null;
  dateOfRecover?: string | null;
  hasBag?: boolean;
  previouslyUsed?: string;
  assignedTo?: number | null;
}

/** Create a new asset. Requires assets.write. */
export async function createAsset(input: AssetInput): Promise<Asset> {
  return request<Asset>('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Update an asset's fields. Requires assets.write. */
export async function updateAsset(id: number, input: Partial<AssetInput>): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Delete an asset. Requires assets.write. */
export async function deleteAsset(id: number): Promise<void> {
  const res = await fetch(`/api/assets/${id}/`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok && res.status !== 204) {
    const json = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new AssetsApiError(json?.detail || `Request failed (${res.status})`, res.status);
  }
}

export interface AssetImportSummary {
  created: number;
  updated: number;
  unassigned: number;
  unmatched: number;
  total: number;
  assigned: number;
}

/** Bulk-upsert assets from a CSV/xlsx file. Sent base64 in JSON because the
 *  API proxy forwards JSON, not multipart. Requires full assets.write. */
export async function importAssets(file: File): Promise<AssetImportSummary> {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AssetsApiError('Could not read the file', 0));
    // result is a data: URL — the backend strips the prefix.
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return request<AssetImportSummary>('/api/assets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentBase64 }),
  });
}
