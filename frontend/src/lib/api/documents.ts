/**
 * Generic documents API client — talks to `/api/documents/*`, which proxies
 * to the Django `documents` app (docs/ARCHITECTURE.md primitive #6: the one
 * file-storage abstraction every module uses instead of inventing its own).
 */

export interface UploadedDocument {
  /** UUID string (Document PK is a UUID — see backend/documents/models.py). */
  id: string | number;
  entityType: string;
  entityId: string;
  employeeId: number | null;
  originalFilename: string;
  /** MIME type as sent by the browser on upload (may be '' if unknown). */
  contentType: string;
  /** Bytes as stored. */
  size: number;
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
  /** Uploader's user id (null for system-generated rows). */
  uploadedBy: number | null;
  uploadedByName: string | null;
}

/** One row of `GET /documents/mine` — every file on the signed-in
 * employee's record, including their signed offer letter. */
export interface MyDocument {
  /** UUID string (Document PK is a UUID — see backend/documents/models.py). */
  id: string | number;
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
  employeeId: number | string,
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
    employeeId: number | string,
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
    employeeId: number | string,
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
  remove: (id: string | number) => request<void>(`/${id}`, { method: 'DELETE' }),
  mine: () => request<MyDocument[]>('/mine').then((v) => v ?? []),

  /* ---------------- Parcel B: audience + acknowledgement (contract in
   * agents/god/documents-backend-spec.md, Parcel A). Shapes are camelCase
   * per the spec; god reconciles if Parcel A's shapes differ at merge.
   * Every method throws DocumentsApiError (404 when Parcel A hasn't
   * landed yet) — callers render an honest empty state, never fake rows. */

  /** All documents visible to the caller (backend applies audience + scope). */
  orgList: () => request<OrgDocument[]>('').then((v) => v ?? []),

  /** HR creates an organization document. Sent as multipart (file required
   * by the documents app) with Parcel A fields alongside. */
  orgCreate: async (input: OrgDocCreate): Promise<OrgDocument> => {
    const form = new FormData();
    form.append('file', input.file);
    form.append('entityType', 'organization_document');
    form.append('entityId', input.entityId ?? 'org');
    form.append('title', input.title);
    if (input.description) form.append('description', input.description);
    form.append('audience', input.audience);
    form.append('acknowledgementRequired', String(input.acknowledgementRequired));
    if (input.expiryDate) form.append('expiryDate', input.expiryDate);
    if (input.folderId !== undefined && input.folderId !== null && input.folderId !== '')
      form.append('folderId', String(input.folderId));
    if (input.audienceRoles) form.append('audienceRoles', JSON.stringify(input.audienceRoles));
    const result = await request<OrgDocument>('', { method: 'POST', body: form });
    return result as OrgDocument;
  },

  /** HR edits an organization document's metadata + audience (roles + per-role
   * view/acknowledge). JSON PATCH; only fields present are changed. */
  orgUpdate: async (id: string | number, input: OrgDocUpdate): Promise<OrgDocument> => {
    const result = await request<OrgDocument>(`/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return result as OrgDocument;
  },

  /** Scope-filtered status list for one document (HR/manager see only
   * employees within their scope). */
  acknowledgements: (id: string | number) =>
    request<AcknowledgementStatus>(`/${id}/acknowledgements`).then(
      (v) => v ?? { total: 0, acknowledged: 0, pending: 0, items: [] },
    ),

  /** Current employee marks a document acknowledged. */
  acknowledge: (id: string | number) =>
    request<void>(`/${id}/acknowledge`, { method: 'POST' }),

  /** Docs the current employee must still acknowledge. */
  pendingAcknowledgement: () =>
    request<PendingAckDoc[]>('/pending-acknowledgement').then((v) => v ?? []),

  /* ---------------- B: organization-document folders ---------------- */

  /** Folders visible to the caller (public to all; private to HR). */
  folders: () => request<DocumentFolder[]>('/folders').then((v) => v ?? []),

  /** HR creates a folder. */
  folderCreate: (input: { name: string; visibility: FolderVisibility; description?: string }) =>
    request<DocumentFolder>('/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),

  /** HR renames / re-scopes / re-describes a folder. */
  folderUpdate: (id: string | number, input: Partial<{ name: string; visibility: FolderVisibility; description: string }>) =>
    request<DocumentFolder>(`/folders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),

  /** HR deletes a folder (its documents are detached, not deleted). */
  folderDelete: (id: string | number) => request<void>(`/folders/${id}`, { method: 'DELETE' }),

  /** Organization documents in a folder (audience-filtered by the backend). */
  folderDocuments: (id: string | number) =>
    request<OrgDocument[]>(`/folders/${id}/documents`).then((v) => v ?? []),

  /** HR sends a reminder to every in-scope employee still pending on a doc. */
  remindAcknowledgement: (id: string | number) =>
    request<{ notified: number }>(`/${id}/remind-acknowledgement`, { method: 'POST' }).then((v) => v ?? { notified: 0 }),

  /* ---------------- W1: verification workflow ---------------- */

  /** Employee-submitted docs awaiting verification in the caller's scope
   * (HR/manager: their scope; plain employee: their own). */
  pendingVerification: () =>
    request<VerifiableDocument[]>('/pending-verification').then((v) => v ?? []),

  /** HR/manager marks a document verified. */
  verify: (id: string | number) =>
    request<VerifiableDocument>(`/${id}/verify`, { method: 'POST' }),

  /** HR/manager marks a document rejected (reason required; owner notified). */
  reject: (id: string | number, reason: string) =>
    request<VerifiableDocument>(`/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),

  /** HR/manager nudges the document's owner to act. */
  nudge: (id: string | number) =>
    request<{ notified: number }>(`/${id}/nudge`, { method: 'POST' }).then((v) => v ?? { notified: 0 }),

  /** Docs expiring within N days (default 30), scope-filtered. */
  expiring: (days = 30) =>
    request<VerifiableDocument[]>(`/expiring?days=${days}`).then((v) => v ?? []),
};

export type FolderVisibility = 'public' | 'private';

/** Verification workflow states (backend documents.Document). The DRF
 * camel-case renderer converts the snake_case serializer fields. */
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

/** An employee-submitted document with its verification state. */
export interface VerifiableDocument extends UploadedDocument {
  verificationStatus?: VerificationStatus | string;
  verifiedBy?: number | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
}
export interface DocumentFolder {
  id: string | number;
  name: string;
  visibility: FolderVisibility;
  description?: string | null;
  documentCount?: number;
}

/** Per-document audience/visibility (Parcel A). Further restricts — never
 * widens past the scope engine. HR Admin always sees all. */
export type OrgDocAudience = 'hr_only' | 'hr_and_manager' | 'employee' | 'all_employees';

export const AUDIENCE_OPTIONS: { value: OrgDocAudience; label: string }[] = [
  { value: 'hr_only', label: 'HR only' },
  { value: 'hr_and_manager', label: 'HR + Manager' },
  { value: 'employee', label: 'Employee' },
  { value: 'all_employees', label: 'All employees' },
];

export function audienceLabel(audience: string | null | undefined): string {
  return AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? 'All employees';
}

/** One organization document (Parcel A fields are optional so the UI also
 * renders pre-Parcel-A rows without crashing). */
export interface OrgDocument {
  id: string | number;
  title?: string | null;
  originalFilename?: string | null;
  description?: string | null;
  acknowledgementRequired?: boolean;
  acknowledgement_required?: boolean;
  audience?: OrgDocAudience | string | null;
  expiryDate?: string | null;
  expiry_date?: string | null;
  size?: number | null;
  fileSize?: number | null;
  uploadedAt?: string | null;
  uploaded_at?: string | null;
  audienceRoles?: AudienceRole[];
}

/** A role that may see a document, and whether that role must acknowledge it
 * (vs view-only). Empty list on a document => the coarse `audience` enum
 * governs instead. */
export interface AudienceRole {
  roleId: number;
  roleName?: string;
  acknowledgeRequired: boolean;
}

export function orgDocTitle(d: OrgDocument): string {
  return d.title || d.originalFilename || 'Untitled document';
}

export function orgDocAckRequired(d: OrgDocument): boolean {
  return d.acknowledgementRequired ?? d.acknowledgement_required ?? false;
}

export interface AcknowledgementEntry {
  employee: number | string;
  name: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledged_at?: string | null;
}

export interface AcknowledgementStatus {
  total: number;
  acknowledged: number;
  pending: number;
  items: AcknowledgementEntry[];
}

export interface PendingAckDoc {
  id: string | number;
  title?: string | null;
  originalFilename?: string | null;
  description?: string | null;
  uploadedAt?: string | null;
  uploaded_at?: string | null;
  expiryDate?: string | null;
  expiry_date?: string | null;
}

export interface OrgDocCreate {
  file: File;
  title: string;
  description?: string;
  audience: OrgDocAudience;
  acknowledgementRequired: boolean;
  expiryDate?: string | null;
  /** Backend entity bucket; defaults to 'org'. */
  entityId?: string;
  /** Organization-documents folder to file this document under. */
  folderId?: string | number | null;
  /** Role-based audience: which roles may see it + per-role view/acknowledge.
   * When set (non-empty) it takes precedence over `audience` on the backend. */
  audienceRoles?: AudienceRole[];
}

/** Editable fields for an existing org document (all optional; omitted fields
 * are left unchanged). */
export interface OrgDocUpdate {
  title?: string;
  description?: string;
  audience?: OrgDocAudience;
  acknowledgementRequired?: boolean;
  expiryDate?: string | null;
  audienceRoles?: AudienceRole[];
}
