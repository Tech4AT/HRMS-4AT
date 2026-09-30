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

export interface AssetListParams {
  search?: string;
  status?: AssetStatus | '';
  assigned?: 'true' | 'false' | '';
  page?: number;
  pageSize?: number;
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
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.assigned) query.set('assigned', params.assigned);
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
