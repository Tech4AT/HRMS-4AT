/**
 * Document templates API client — talks to `/api/document-templates/*`,
 * which proxies to the Django `document_templates` app (the templates
 * engine: folders, CRUD, generate). House envelope {success, data}.
 */

export interface TemplateFolder {
  id: number;
  name: string;
  ordering: number;
  templateCount: number;
}

export interface DocumentTemplate {
  id: number;
  name: string;
  folder: number | null;
  folderName: string | null;
  actionType: string;
  workflowEnabled: boolean;
  body: string;
  file: string | null;
  lastUsedAt: string | null;
  createdByName: string | null;
}

export interface GeneratedDocument {
  id: number;
  name: string;
  folderName: string | null;
  actionType: string;
  body: string;
  /** {{placeholder}} tokens found in the body — merge these client-side. */
  placeholders: string[];
  fileUrl: string | null;
  generatedAt: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class TemplatesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TemplatesApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const res = await fetch(`/api/document-templates${path}`, { credentials: 'include', ...init });
  if (res.status === 204) return undefined;

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;
    throw new TemplatesApiError(message, res.status);
  }
  return json.data;
}

export interface TemplateFilters {
  search?: string;
  folder?: string | number;
  actionType?: string;
  workflowEnabled?: boolean;
}

export const documentTemplatesApi = {
  list: (filters: TemplateFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.folder) params.set('folder', String(filters.folder));
    if (filters.actionType) params.set('actionType', filters.actionType);
    if (filters.workflowEnabled !== undefined) params.set('workflowEnabled', String(filters.workflowEnabled));
    const qs = params.toString();
    return request<DocumentTemplate[]>(qs ? `?${qs}` : '').then((v) => v ?? []);
  },
  folders: () => request<TemplateFolder[]>('/folders').then((v) => v ?? []),
  create: (payload: { name: string; folder?: number | null; actionType?: string; workflowEnabled?: boolean; body?: string }) =>
    request<DocumentTemplate>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((v) => v as DocumentTemplate),
  generate: (id: number) =>
    request<GeneratedDocument>(`/${id}/generate`, { method: 'POST' }).then((v) => v as GeneratedDocument),
};
