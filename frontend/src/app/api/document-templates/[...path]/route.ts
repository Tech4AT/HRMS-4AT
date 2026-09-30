import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/document-templates/... → Django /document-templates/...
// (detail, folders, generate).
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxyRoute('document-templates');
