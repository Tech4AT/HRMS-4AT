/**
 * Generic documents API client — talks to `/api/documents/*`, which proxies
 * to the Django `documents` app (docs/ARCHITECTURE.md primitive #6: the one
 * file-storage abstraction every module uses instead of inventing its own).
 */

export interface UploadedDocument {
  id: number;
  entityType: string;
  entityId: string;
  employeeId: number | null;
  originalFilename: string;
  /** Alias of `viewUrl`, kept for callers that predate the view/download split. */
  url: string | null;
  /** Opens inline (Content-Disposition: inline) — for the document viewer. */
  viewUrl: string | null;
  /** Forces a save-as (Content-Disposition: attachment). */
  downloadUrl: string | null;
  uploadedAt: string;
  expiryDate: string | null;
  isExpired: boolean;
  /** Bytes; null if the file is missing from storage or its size can't be read. */
  fileSize: number | null;
  uploadedByName: string | null;
}

/** One row of `GET /documents/mine` — every file on the signed-in
 * employee's record, including their signed offer letter. */
export interface MyDocument {
  id: number;
  category: 'Offer letter' | 'Onboarding' | 'Identity' | 'Education' | 'Letters' | 'Other';
  title: string;
  entityType: string;
  entityId: string;
  originalFilename: string;
  uploadedAt: string;
  viewUrl: string;
  downloadUrl: string;
  canReplace: boolean;
  canDelete: boolean;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class DocumentsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DocumentsApiError';
  }
}

/** Mirrors backend/documents/views.py's ALLOWED_DOCUMENT_EXTENSIONS /
 * MAX_DOCUMENT_SIZE_BYTES — checked client-side too so a bad file is
 * rejected before spending an upload round-trip, never as a replacement
 * for the server-side check. */
export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
export const MAX_DOCUMENT_SIZE_MB = 10;

export function validateDocumentFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
    return `Unsupported file type "${ext || 'unknown'}". Allowed: ${ALLOWED_DOCUMENT_EXTENSIONS.join(', ')}.`;
  }
  if (file.size > MAX_DOCUMENT_SIZE_MB * 1024 * 1024) {
    return `File exceeds the ${MAX_DOCUMENT_SIZE_MB} MB limit.`;
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const res = await fetch(`/api/documents${path}`, { credentials: 'include', ...init });
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
    throw new DocumentsApiError(message, res.status);
  }
  return json.data;
}

function buildUploadForm(
  file: File,
  entityType: string,
  entityId: string | number,
  employeeId: number,
  expiryDate?: string | null,
): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('entityType', entityType);
  form.append('entityId', String(entityId));
  form.append('employeeId', String(employeeId));
  if (expiryDate) form.append('expiryDate', expiryDate);
  return form;
}

export const documentsApi = {
  list: (entityType: string, entityId: string | number) =>
    request<UploadedDocument[]>(`?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(String(entityId))}`).then(
      (v) => v ?? [],
    ),
  upload: async (
    file: File,
    entityType: string,
    entityId: string | number,
    employeeId: number,
    expiryDate?: string | null,
  ): Promise<UploadedDocument> => {
    const result = await request<UploadedDocument>('', {
      method: 'POST',
      body: buildUploadForm(file, entityType, entityId, employeeId, expiryDate),
    });
    return result as UploadedDocument;
  },
  /** Same as `upload`, but over XMLHttpRequest so `onProgress` gets real
   * browser upload-progress events — `fetch()` has no public API for that. */
  uploadWithProgress: (
    file: File,
    entityType: string,
    entityId: string | number,
    employeeId: number,
    onProgress: (percent: number) => void,
    expiryDate?: string | null,
  ): Promise<UploadedDocument> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/documents', true);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let json: Envelope<UploadedDocument> | null = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          json = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && json?.success && json.data) {
          resolve(json.data);
        } else {
          const raw = json?.error?.message;
          const message = Array.isArray(raw) ? raw.join(', ') : raw || `Upload failed (${xhr.status})`;
          reject(new DocumentsApiError(message, xhr.status));
        }
      };
      xhr.onerror = () => reject(new DocumentsApiError('Network error during upload', 0));
      xhr.send(buildUploadForm(file, entityType, entityId, employeeId, expiryDate));
    });
  },
  remove: (id: number) => request<void>(`/${id}`, { method: 'DELETE' }),
  mine: () => request<MyDocument[]>('/mine').then((v) => v ?? []),
};
