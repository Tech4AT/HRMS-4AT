/**
 * Browser-side Onboarding/Preboarding API client. Talks only to the local
 * `/api/onboarding/*` route handlers (never the Django backend directly);
 * those proxy to Django and carry the httpOnly session cookie.
 */

/** Document file row (mirrors the documents API shape; inlined here so this
 * client does not depend on the documents module). */
export interface UploadedDocument {
  id: number;
  entityType: string;
  entityId: string;
  employeeId: number | null;
  originalFilename: string;
  url: string | null;
  viewUrl: string | null;
  downloadUrl: string | null;
  uploadedAt: string;
  expiryDate: string | null;
  isExpired: boolean;
  fileSize: number | null;
  uploadedByName: string | null;
}

export type OnboardingStage = 'preboarding' | 'onboarding' | 'completed';
export type TaskCategory = 'preboarding' | 'onboarding';
export type TaskOwner = 'new_hire' | 'hr_admin' | 'manager' | 'buddy' | 'it_admin';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export type EmploymentType = 'full_time' | 'contract' | 'intern';
export type OfferLetterStatus =
  | 'draft'
  | 'generated'
  | 'sent'
  | 'viewed'
  | 'awaiting_signature'
  | 'signed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';
export type OfferRejectionReason =
  | 'compensation'
  | 'another_offer'
  | 'personal_reasons'
  | 'joining_date'
  | 'location'
  | 'job_role'
  | 'other';
export type BackgroundVerificationStatus = 'not_started' | 'pending_documents' | 'ready_for_review' | 'passed' | 'failed';

export interface EmployeeSummary {
  id: number;
  name: string;
  workEmail: string;
  personalEmail: string;
  employeeCode: string;
  departmentId: number | null;
  designationId: number | null;
}

export interface EmployeeLookupItem {
  id: number;
  name: string;
  workEmail: string;
  employeeCode: string;
}

export interface OnboardingProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface OnboardingTask {
  id: number;
  profileId: number;
  category: TaskCategory;
  title: string;
  description: string;
  owner: TaskOwner;
  isRequired: boolean;
  requiresDocument: boolean;
  dueDate: string | null;
  status: TaskStatus;
  sortOrder: number;
  completedAt: string | null;
  /** A named person who may complete this task, besides its owner role. */
  assignee: AssignedPerson | null;
}

export interface AssignedPerson {
  id: number;
  name: string;
  workEmail: string;
}

export interface OfferLetter {
  id: number;
  offerNumber: string;
  version: number;
  isCurrent: boolean;
  basicSalary: string;
  hra: string;
  otherAllowances: string;
  otherComponents: string;
  /** Always basicSalary + hra + otherAllowances + otherComponents — never entered directly. */
  annualCtc: string;
  currency: string;
  employmentType: EmploymentType;
  employmentTypeDisplay: string;
  probationPeriodMonths: number;
  noticePeriodDays: number;
  status: OfferLetterStatus;
  statusDisplay: string;
  documentUrl: string | null;
  templateId: number | null;
  templateName: string | null;
  generatedAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  expiresAt: string | null;
  signedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  signatureName: string;
  rejectionReason: OfferRejectionReason | '';
  rejectionReasonDisplay: string | null;
  rejectionComments: string;
}

export interface BackgroundVerification {
  id: number;
  status: BackgroundVerificationStatus;
  statusDisplay: string;
  notes: string;
  readyAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** How many of this hire's tasks require a document (Submit ID proof, etc). */
  documentCount: number;
  documentsSubmitted: number;
}

export interface BankDetails {
  id: number;
  accountHolderName: string;
  /** Present only for the candidate's own self-service view, or an HR/
   * finance view fetched with `?reveal=true` — otherwise omitted entirely
   * by the backend (see onboarding/serializers.py::BankDetailsSerializer),
   * not just hidden client-side. */
  accountNumber?: string;
  accountNumberMasked: string;
  ifscCode: string;
  bankName: string;
  branchName: string;
  updatedAt: string;
}

export interface BankDetailsInput {
  accountHolderName: string;
  accountNumber: string;
  ifscCode?: string;
  bankName?: string;
  branchName?: string;
}

export type IdentityDocumentType = 'aadhaar' | 'pan' | 'voter_id' | 'passport' | 'driving_license' | 'other';
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

export interface IdentityDocument {
  id: number;
  documentType: IdentityDocumentType;
  documentTypeDisplay: string;
  /** Present only for the candidate's own view, or an HR/finance view
   * fetched with `?reveal=true` — otherwise omitted by the backend
   * entirely (see onboarding/serializers.py::IdentityDocumentSerializer). */
  documentNumber?: string;
  documentNumberMasked: string;
  fullName: string;
  dateOfBirth: string | null;
  expiryDate: string | null;
  isExpired: boolean;
  address: string;
  gender: string;
  parentOrGuardianName: string;
  fileUrl: string | null;
  fileDownloadUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  verificationStatus: VerificationStatus;
  verificationStatusDisplay: string;
  verificationNotes: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
  submittedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityDocumentInput {
  documentType: IdentityDocumentType;
  documentNumber: string;
  fullName?: string;
  dateOfBirth?: string | null;
  expiryDate?: string | null;
  address?: string;
  gender?: string;
  parentOrGuardianName?: string;
}

export const IDENTITY_DOCUMENT_TYPE_LABEL: Record<IdentityDocumentType, string> = {
  aadhaar: 'Aadhaar Card',
  pan: 'PAN Card',
  voter_id: 'Voter ID',
  passport: 'Passport',
  driving_license: 'Driving License',
  other: 'Other',
};

export const IDENTITY_NUMBER_FIELD_LABEL: Record<IdentityDocumentType, string> = {
  aadhaar: 'Aadhaar Number',
  pan: 'Permanent Account Number',
  voter_id: 'Voter ID Number',
  passport: 'Passport Number',
  driving_license: 'Driving License Number',
  other: 'Document Number',
};

export const VERIFICATION_STATUS_COLOR: Record<VerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

/** A generic-document folder ("Resume", "Degrees & Certificates", ...) —
 * `entityType`/`entityId` are what to pass to `documentsApi.upload/list` for
 * this folder. Resolved server-side (see onboarding/views.py::MyDocumentsOverviewView)
 * so the frontend never has to know which onboarding task a folder maps to. */
export interface DocumentFolderBucket {
  entityType: string;
  entityId: string;
  documents: UploadedDocument[];
}

export interface OfferLetterEntry {
  offerId: number;
  offerNumber: string;
  version: number;
  status: OfferLetterStatus;
  documents: UploadedDocument[];
}

export type EducationVerificationStatus = 'pending' | 'verified' | 'rejected';

/** One degree/certificate — several are expected per employee (school,
 * undergrad, postgrad...), each independently reviewed by HR. Same
 * structured-fields-plus-linked-file shape as IdentityDocument. */
export interface EducationRecord {
  id: number;
  degree: string;
  branch: string;
  university: string;
  yearOfJoining: number | null;
  yearOfCompletion: number | null;
  grade: string;
  fileUrl: string | null;
  fileDownloadUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  verificationStatus: EducationVerificationStatus;
  verificationStatusDisplay: string;
  verificationNotes: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
  submittedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EducationRecordInput {
  degree: string;
  branch?: string;
  university?: string;
  yearOfJoining?: number | null;
  yearOfCompletion?: number | null;
  grade?: string;
}

export type EmployeeLetterType = 'appointment' | 'appraisal' | 'promotion' | 'other';

/** An HR-issued letter beyond the offer letter. Always HR-authored — there
 * is no employee-facing "add" endpoint for this. */
export interface EmployeeLetterRecord {
  id: number;
  letterType: EmployeeLetterType;
  letterTypeDisplay: string;
  title: string;
  issuedDate: string | null;
  fileUrl: string | null;
  fileDownloadUrl: string | null;
  fileName: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export const EMPLOYEE_LETTER_TYPE_LABEL: Record<EmployeeLetterType, string> = {
  appointment: 'Appointment Letter',
  appraisal: 'Appraisal Letter',
  promotion: 'Promotion Letter',
  other: 'Other',
};

export interface MyDocumentsOverview {
  employeeId: number;
  resume: DocumentFolderBucket;
  educationRecords: EducationRecord[];
  previousExperience: DocumentFolderBucket;
  offerLetters: OfferLetterEntry[];
  employeeLetters: EmployeeLetterRecord[];
}

export interface OfferLetterTemplate {
  id: number;
  name: string;
  heading: string;
  body: string;
  isDefault: boolean;
  isActive: boolean;
  placeholders: string[];
  /** Set when HR uploaded a Word (.docx) file instead of typing `body` —
   * when present, it's what actually gets filled in and sent as the PDF. */
  sourceDocxName: string | null;
  sourceDocxUrl: string | null;
}

export interface OfferLetterTemplateInput {
  name: string;
  heading: string;
  /** Optional when a .docx file is uploaded instead (see `createOfferLetterTemplate`/`updateOfferLetterTemplate`). */
  body?: string;
  isDefault?: boolean;
}

export interface OnboardingRecord {
  id: number;
  employee: EmployeeSummary;
  buddy: EmployeeSummary | null;
  stage: OnboardingStage;
  joiningDate: string;
  employeeStatus: string;
  day1CompletedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  tasks: OnboardingTask[];
  progress: OnboardingProgress;
  /** null if the record has none, or if the caller isn't permitted to see
   * salary (server-gated — a manager viewing this same record gets null). */
  offerLetter: OfferLetter | null;
  /** null if the caller isn't HR Admin (server-gated, same as offerLetter). */
  backgroundVerification: BackgroundVerification | null;
}

export interface OnboardingRecordListItem {
  id: number;
  employee: EmployeeSummary;
  stage: OnboardingStage;
  joiningDate: string;
  employeeStatus: string;
  progress: OnboardingProgress;
  offerLetter: OfferLetter | null;
}

export interface MyOnboarding extends OnboardingRecord {
  myOwnerRole: TaskOwner | null;
}

export interface OnboardingTemplate {
  id: number;
  category: TaskCategory;
  title: string;
  description: string;
  owner: TaskOwner;
  isRequired: boolean;
  requiresDocument: boolean;
  offsetDays: number;
  sortOrder: number;
  isActive: boolean;
  assigneeId: number | null;
  assignee: AssignedPerson | null;
}

export interface CreateNewHireInput {
  firstName: string;
  lastName: string;
  workEmail: string;
  personalEmail?: string;
  phone?: string;
  departmentId?: number | null;
  designationId?: number | null;
  managerId?: number | null;
  dottedLineManagerId?: number | null;
  buddyId?: number | null;
  locationId?: number | null;
  legalEntityId?: number | null;
  businessUnitId?: number | null;
  costCenterId?: number | null;
  joiningDate: string;
  temporaryPassword?: string;
  /** Annual figures — Total CTC is always their sum, never entered directly. */
  basicSalary: number;
  hra?: number;
  otherAllowances?: number;
  otherComponents?: number;
  currency?: string;
  employmentType?: EmploymentType;
  workerType?: string;
  probationPeriodMonths?: number;
  noticePeriodDays?: number;
  offerLetterTemplateId?: number | null;
}

export interface UpdateOfferLetterInput {
  basicSalary?: number;
  hra?: number;
  otherAllowances?: number;
  otherComponents?: number;
  currency?: string;
  employmentType?: EmploymentType;
  probationPeriodMonths?: number;
  noticePeriodDays?: number;
  templateId?: number;
}

export interface CreateTaskInput {
  category: TaskCategory;
  title: string;
  description?: string;
  owner: TaskOwner;
  isRequired?: boolean;
  requiresDocument?: boolean;
  dueDate?: string | null;
  sortOrder?: number;
}

export interface TemplateInput {
  category: TaskCategory;
  title: string;
  description?: string;
  owner: TaskOwner;
  isRequired?: boolean;
  requiresDocument?: boolean;
  offsetDays?: number;
  sortOrder?: number;
  assigneeId?: number | null;
}

export type AccessArea = 'bank_details' | 'identity_documents' | 'education' | 'laptop' | 'work_email' | 'id_card';
export const IT_ACCESS_AREAS: AccessArea[] = ['laptop', 'work_email', 'id_card'];

export interface AccessGrant {
  id: number;
  area: AccessArea;
  areaDisplay: string;
  employeeId: number | null;
  name: string;
  email: string;
  createdAt: string;
}

export interface WorkTask extends OnboardingTask {
  recordId: number;
  employeeName: string;
  employeeCode: string;
  joiningDate: string;
}

export interface WorkRecord {
  id: number;
  stage: OnboardingStage;
  employeeName: string;
  employeeCode: string;
  joiningDate: string;
  bankDetails?: BankDetails | null;
  identityDocuments?: IdentityDocument[];
  educationRecords?: EducationRecord[];
}

export interface MyOnboardingWork {
  tasks: WorkTask[];
  areas: AccessArea[];
  records: WorkRecord[];
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[]; fields?: Record<string, string[]> };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class OnboardingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'OnboardingApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies (offer letter template uploads) must let fetch() set its
  // own multipart Content-Type with the boundary — forcing JSON here would
  // silently corrupt the upload.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(`/api/onboarding${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body && !isFormData
      ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
      : init?.headers,
  });

  if (res.status === 204) return undefined as T;

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;

    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OnboardingApiError(message, res.status, json?.error?.fields);
  }

  return json.data as T;
}

export const onboardingApi = {
  getRecords: (stage?: OnboardingStage) =>
    request<OnboardingRecordListItem[]>(`/records${stage ? `?stage=${stage}` : ''}`),
  getRecord: (id: number) => request<OnboardingRecord>(`/records/${id}`),
  createRecord: (input: CreateNewHireInput) =>
    request<OnboardingRecord>('/records', { method: 'POST', body: JSON.stringify(input) }),
  updateRecord: (id: number, input: { buddyId?: number | null; workEmail?: string; personalEmail?: string }) =>
    request<OnboardingRecord>(`/records/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  complete: (id: number) => request<OnboardingRecord>(`/records/${id}/complete`, { method: 'POST' }),
  addTask: (recordId: number, input: CreateTaskInput) =>
    request<OnboardingTask>(`/records/${recordId}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  setTaskStatus: (taskId: number, status: TaskStatus) =>
    request<OnboardingTask>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  removeTask: (taskId: number) => request<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
  getMine: () => request<MyOnboarding | null>('/me'),
  getOfferLetter: (recordId: number) => request<OfferLetter>(`/records/${recordId}/offer-letter`),
  updateOfferLetter: (recordId: number, input: UpdateOfferLetterInput) =>
    request<OfferLetter>(`/records/${recordId}/offer-letter`, { method: 'PATCH', body: JSON.stringify(input) }),
  sendOfferLetter: (recordId: number) =>
    request<OfferLetter>(`/records/${recordId}/offer-letter/send`, { method: 'POST' }),
  resendOfferLetter: (recordId: number) =>
    request<OfferLetter>(`/records/${recordId}/offer-letter/resend`, { method: 'POST' }),
  cancelOfferLetter: (recordId: number) =>
    request<OfferLetter>(`/records/${recordId}/offer-letter/cancel`, { method: 'POST' }),
  extendOfferLetter: (recordId: number, additionalHours: number) =>
    request<OfferLetter>(`/records/${recordId}/offer-letter/extend`, {
      method: 'POST',
      body: JSON.stringify({ additionalHours }),
    }),
  getTemplates: () => request<OnboardingTemplate[]>('/templates'),
  createTemplate: (input: TemplateInput) =>
    request<OnboardingTemplate>('/templates', { method: 'POST', body: JSON.stringify(input) }),
  updateTemplate: (id: number, input: Partial<TemplateInput> & { isActive?: boolean }) =>
    request<OnboardingTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deactivateTemplate: (id: number) => request<void>(`/templates/${id}`, { method: 'DELETE' }),
  getOfferLetterTemplates: () => request<OfferLetterTemplate[]>('/offer-letter-templates'),
  createOfferLetterTemplate: (input: OfferLetterTemplateInput, file?: File | null) =>
    request<OfferLetterTemplate>('/offer-letter-templates', { method: 'POST', body: buildTemplateFormData(input, file) }),
  updateOfferLetterTemplate: (
    id: number,
    input: Partial<OfferLetterTemplateInput> & { isActive?: boolean; removeSourceDocx?: boolean },
    file?: File | null,
  ) => request<OfferLetterTemplate>(`/offer-letter-templates/${id}`, { method: 'PATCH', body: buildTemplateFormData(input, file) }),
  deactivateOfferLetterTemplate: (id: number) => request<void>(`/offer-letter-templates/${id}`, { method: 'DELETE' }),
  getBackgroundVerification: (recordId: number) =>
    request<BackgroundVerification>(`/records/${recordId}/background-verification`),
  decideBackgroundVerification: (recordId: number, status: 'passed' | 'failed', notes?: string) =>
    request<BackgroundVerification>(`/records/${recordId}/background-verification`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    }),
  /** A plain link (not fetch): the browser's own cookie-bearing navigation
   * is what makes the auth cookies reach the proxy route for this download. */
  downloadAllDocumentsUrl: (recordId: number) => `/api/onboarding/records/${recordId}/documents/download-all`,
  getMyBankDetails: () => request<BankDetails | null>('/me/bank-details'),
  saveMyBankDetails: (input: BankDetailsInput) =>
    request<BankDetails>('/me/bank-details', { method: 'PUT', body: JSON.stringify(input) }),
  /** HR/finance only; masked unless `reveal` is passed — see
   * onboarding/views.py::BankDetailsDetailView (revealing is its own
   * audited action, not implied by loading the record). */
  getBankDetails: (recordId: number, reveal = false) =>
    request<BankDetails | null>(`/records/${recordId}/bank-details${reveal ? '?reveal=true' : ''}`),
  getMyIdentityDocuments: () => request<IdentityDocument[]>('/me/identity-documents'),
  addMyIdentityDocument: (input: IdentityDocumentInput) =>
    request<IdentityDocument>('/me/identity-documents', { method: 'POST', body: JSON.stringify(input) }),
  removeMyIdentityDocument: (id: number) => request<void>(`/me/identity-documents/${id}`, { method: 'DELETE' }),
  updateMyIdentityDocument: (id: number, input: Partial<Omit<IdentityDocumentInput, 'documentType'>>) =>
    request<IdentityDocument>(`/me/identity-documents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  /** HR/finance only; masked unless `reveal` is passed — same rule as
   * getBankDetails above. */
  getIdentityDocuments: (recordId: number, reveal = false) =>
    request<IdentityDocument[]>(`/records/${recordId}/identity-documents${reveal ? '?reveal=true' : ''}`),
  verifyIdentityDocument: (id: number, status: 'verified' | 'rejected', notes?: string) =>
    request<IdentityDocument>(`/identity-documents/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ status, notes }) }),
  getMyDocumentsOverview: () => request<MyDocumentsOverview>('/me/documents-overview'),
  getMyEducationRecords: () => request<EducationRecord[]>('/me/education-records'),
  addMyEducationRecord: (input: EducationRecordInput) =>
    request<EducationRecord>('/me/education-records', { method: 'POST', body: JSON.stringify(input) }),
  removeMyEducationRecord: (id: number) => request<void>(`/me/education-records/${id}`, { method: 'DELETE' }),
  setTaskAssignee: (taskId: number, assigneeId: number | null) =>
    request<OnboardingTask>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ assigneeId }) }),
  getAccessGrants: () => request<{ areas: { value: AccessArea; label: string }[]; grants: AccessGrant[] }>('/access-grants'),
  addAccessGrant: (area: AccessArea, employeeId: number) =>
    request<AccessGrant>('/access-grants', { method: 'POST', body: JSON.stringify({ area, employeeId }) }),
  removeAccessGrant: (id: number) => request<void>(`/access-grants/${id}`, { method: 'DELETE' }),
  grantBulkIT: (employeeId: number) =>
    request<{ granted: AccessArea[]; alreadyHad: AccessArea[] }>('/access-grants/bulk-it', {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    }),
  getMyWork: () => request<MyOnboardingWork>('/work'),
  updateMyEducationRecord: (id: number, input: Partial<EducationRecordInput>) =>
    request<EducationRecord>(`/me/education-records/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  getEducationRecords: (recordId: number) => request<EducationRecord[]>(`/records/${recordId}/education-records`),
  verifyEducationRecord: (id: number, status: 'verified' | 'rejected', notes?: string) =>
    request<EducationRecord>(`/education-records/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ status, notes }) }),
  getMyEmployeeLetters: () => request<EmployeeLetterRecord[]>('/me/employee-letters'),
  getEmployeeLetters: (recordId: number) => request<EmployeeLetterRecord[]>(`/records/${recordId}/employee-letters`),
  /** HR only — always HR-authored, no employee-facing equivalent. */
  addEmployeeLetter: (
    recordId: number,
    input: { letterType: EmployeeLetterType; title?: string; issuedDate?: string | null },
    file: File,
  ) => {
    const form = new FormData();
    form.append('letterType', input.letterType);
    if (input.title) form.append('title', input.title);
    if (input.issuedDate) form.append('issuedDate', input.issuedDate);
    form.append('file', file);
    return request<EmployeeLetterRecord>(`/records/${recordId}/employee-letters`, { method: 'POST', body: form });
  },
};

function buildTemplateFormData(
  input: Partial<OfferLetterTemplateInput> & { isActive?: boolean; removeSourceDocx?: boolean },
  file?: File | null,
): FormData {
  const form = new FormData();
  if (input.name !== undefined) form.append('name', input.name);
  if (input.heading !== undefined) form.append('heading', input.heading);
  if (input.body !== undefined) form.append('body', input.body);
  if (input.isDefault !== undefined) form.append('isDefault', String(input.isDefault));
  if (input.isActive !== undefined) form.append('isActive', String(input.isActive));
  if (input.removeSourceDocx) form.append('removeSourceDocx', 'true');
  if (file) form.append('file', file);
  return form;
}

export const STAGE_LABEL: Record<OnboardingStage, string> = {
  preboarding: 'Preboarding',
  onboarding: 'Onboarding',
  completed: 'Completed',
};

export const STAGE_COLOR: Record<OnboardingStage, string> = {
  preboarding: 'bg-amber-100 text-amber-700',
  onboarding: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

export const OWNER_LABEL: Record<TaskOwner, string> = {
  new_hire: 'New hire',
  hr_admin: 'HR Admin',
  manager: 'Manager',
  buddy: 'Buddy',
  it_admin: 'IT Admin',
};

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
  intern: 'Intern',
};

export const OFFER_STATUS_LABEL: Record<OfferLetterStatus, string> = {
  draft: 'Draft — not sent',
  generated: 'Ready to send',
  sent: 'Sent',
  viewed: 'Viewed by candidate',
  awaiting_signature: 'Awaiting signature',
  signed: 'Signed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const OFFER_STATUS_COLOR: Record<OfferLetterStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generated: 'bg-gray-100 text-gray-600',
  sent: 'bg-amber-100 text-amber-700',
  viewed: 'bg-amber-100 text-amber-700',
  awaiting_signature: 'bg-amber-100 text-amber-700',
  signed: 'bg-emerald-100 text-emerald-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

/** What's next for HR on this offer — matches the "Next Action" line in the
 * dashboard mockup (docs/REQUIREMENTS.md §19). */
export function offerNextAction(status: OfferLetterStatus): string {
  switch (status) {
    case 'draft':
    case 'generated':
      return 'Send the offer letter';
    case 'sent':
    case 'viewed':
    case 'awaiting_signature':
      return 'Waiting for candidate';
    case 'signed':
    case 'accepted':
      return 'Preboarding started';
    case 'rejected':
      return 'Workflow stopped';
    case 'expired':
      return 'Resend or extend the offer';
    case 'cancelled':
      return 'Withdrawn — edit the offer to send a new version';
    default:
      return '—';
  }
}

export const REJECTION_REASON_LABEL: Record<OfferRejectionReason, string> = {
  compensation: 'Compensation',
  another_offer: 'Accepted another offer',
  personal_reasons: 'Personal reasons',
  joining_date: 'Joining date',
  location: 'Location',
  job_role: 'Job role',
  other: 'Other',
};

export const BGV_STATUS_LABEL: Record<BackgroundVerificationStatus, string> = {
  not_started: 'Not started',
  pending_documents: 'Pending documents',
  ready_for_review: 'Ready for review',
  passed: 'Passed',
  failed: 'Failed',
};

export const BGV_STATUS_COLOR: Record<BackgroundVerificationStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  pending_documents: 'bg-amber-100 text-amber-700',
  ready_for_review: 'bg-blue-100 text-blue-700',
  passed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

export function formatCurrency(amount: string | number, currency: string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${currency} ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Same as formatDate but keeps the time — for offer workflow timestamps
 * (sent/viewed/signed/rejected), which carry a real time-of-day, unlike a
 * plain joining/expiry date. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
