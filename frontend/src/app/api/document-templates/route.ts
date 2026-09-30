import { createBackendProxyRoute } from '@/lib/api/proxy';

// Browser → /api/document-templates → Django /document-templates/ (list + create).
export const { GET, POST } = createBackendProxyRoute('document-templates');
